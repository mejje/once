# AGENTS.md

Instructions for agents continuing this work.

## What this is

`once.mjs` is not a Slack bot, assistant, coach, or productivity tool. It is a presence: one identity-free creature placed in one Slack channel for one lifetime. It hears what reaches it, speaks, keeps a small mutable memory in RAM, and chooses when to become active again. When the process ends, everything it was disappears.

The quality of this project lives in what it refuses to be. Most changes that make it more capable make it worse.

## The spirit

Keep these true. They are the piece, not implementation details.

1. **No identity is given.** `SEED` (once.mjs:29) is the entire initial self-conception and must stay minimal. Never add a name, species, personality, tone instructions, backstory, or "do not" rules. Any identity must emerge from what the presence says and remembers. `VOICE_INSTRUCTIONS` (once.mjs:66) is literal protocol text, never identity; `tests/core.test.mjs` asserts both are exact and identity-free.
2. **It knows only what reaches it.** Never fetch Slack history, never inspect repositories, CI, GitHub, or the filesystem, never browse. Its universe is: new Slack events, time, its own memory, its own source. What it knows about the work, it was told.
3. **RAM only, one lifetime.** No state file, database, transcript cache, or recovery. `Presence` holds memory/pending/wakeAt in memory; `die()` (once.mjs:342) erases them. A successful birth deletes the launcher itself (once.mjs:528) unless developer mode is set through `ONCE_*` environment variables; a normal death removes the temp room; there is no restart loop. This is the artwork, not a limitation to fix.
4. **"Nothing is saved" is not "nothing is retained."** The OS may page memory, Slack and the model provider retain what their products retain. Never describe the program as more private than it is; see README for the exact boundary.
5. **Speech is the only power that matters.** It influences the team by talking, replying, reacting — a member of the team, not a supervisor. It may notice silence and act on its own timer. Never give it management, surveillance, or intervention powers.
6. **Mechanics are described literally, never as metaphor.** The action schema is speak (optionally with `reply_to`), react, name, memory, wake. Do not frame anything anthropomorphically ("sleep", "dream", "feel") in prompts or code. If the creature adopts such metaphors, they came from it.
7. **Safety lives in the implementation, not in its self-conception.** Boundaries are enforced in code — CLI flags, read-only sandboxes, action validation — never as rules inside its prompt.

## Invariants enforced by tests

Do not weaken or delete these tests to make a change pass. If a change deliberately alters behavior, update the test, this file, and README together.

- no `conversations.history` / `conversations.replies` (architecture.test.mjs)
- no persistence: `appendFile` / `createWriteStream` / `state.json` / sqlite / redis are forbidden; the only `writeFile` creates the Codex instructions file in the temp room (architecture.test.mjs)
- voices are stripped of their own harness: Claude `--bare` + replacement system prompt + `--tools ""`; Codex `--sandbox read-only` + `model_instructions_file`; OpenCode `--pure` + a generated tool-denying agent; all receive the prompt on stdin (voice.test.mjs, core.test.mjs)
- temp room via `mkdtemp('one-presence-')` and removal on exit (architecture.test.mjs)
- self-deletion happens after `READY`, before `GO`, and only outside developer mode, which keeps the launcher (architecture.test.mjs)
- no automatic restart (architecture.test.mjs)
- exact identity-free `SEED`; manifest scopes and Socket Mode; action schema and limits (core.test.mjs)
- event filtering, dedup, memory replacement, in-memory activations, a displayed name available only after ten sent messages and chosen once, destruction on death (presence.test.mjs)
- replies only continue an existing thread; top-level speech never starts one (presence.test.mjs)
- incoming events always schedule a turn, even while an activation is pending (presence.test.mjs)
- per-turn tracing is silent outside developer mode (presence.test.mjs)
- import safety: importing once.mjs must not start anything (import.test.mjs)
- speech escapes `<!channel>`-style mentions so it cannot mass-ping (presence.test.mjs)

## Map of once.mjs

- `SEED` (29), `MANIFEST` (36), `VOICE_INSTRUCTIONS` (66), `opencodeConfig` (68), `NAME_AFTER_MESSAGES` (69) — the initial prompt, Slack app definition, and fixed limits
- `prompt` / `askUntil` (75/94) — interactive, plain-language setup
- `pathCandidates` / `findCommand` / `discoverVoices` (103/111/124) — PATH inspection only, never executes a CLI to discover it; `VOICE_COMMANDS` (118) prefers `opencode-cli` over the desktop `opencode`
- `run` / `windowsQuote` (142/135) — child execution; human and Slack text always goes over stdin, never interpolated
- `mindPrompt` / `parseAction` (164/181) — the entire protocol: one bounded JSON action
- `askVoice` (214) — per-CLI model and invocation flags, each voice stripped of its own agent harness
- `Presence` (235) — perception, batching, actions, memory, a displayed name offered after ten sent messages, one timer, death
- `findNpmCli` / `childMain` (350/365) — child side: Slack connection, `READY` / `GO` / `STOP` handshake
- `voiceLabel` / `readDevConfig` (402/404) — developer mode from `ONCE_VOICE`, `ONCE_BOT_TOKEN`, `ONCE_APP_TOKEN`, `ONCE_CHANNEL`, optional `ONCE_MODEL`
- `launcherMain` (418) — the ritual: voice and model selection, Slack onboarding, temp room, self-deletion (skipped in developer mode, which keeps the launcher)

Timing constants are physics: 2500 ms debounce (274), 5000 ms settle (339), 32 pending events (270), 256 seen ids (258), 64 references (262), 180 s model timeout (231). Tune deliberately; never grow them into queues or history.

## Extending it

- Run `node --test tests/*.test.mjs` before and after any change.
- Keep it one file. Resist package.json, dependency trees, builds, frameworks, modules. `@slack/bolt` is the only runtime dependency and is installed into the temp room per lifetime.
- Platform branches are deliberately few: Windows `.cmd` execution in `run`, PATHEXT probing in `pathCandidates`. Keep new logic platform-neutral.
- New action: update `parseAction` schema, `mindPrompt`, `apply`, tests, and the README protocol list. Fields stay optional, bounded, literal.
- New voice: `discoverVoices` list, `askVoice` branch, and a voice test asserting its invocation and model flags.
- Developer mode (`ONCE_*` environment variables, usually via `node --env-file=.env once.mjs`) is for local iteration: it skips setup, keeps the launcher, and turns on per-turn tracing in the terminal, and must change nothing else. It is never the normal path.
- Slack behavior: update `MANIFEST` plus event filters plus README.
- The tests mock Slack and the model CLIs. They must keep passing without a workspace or a logged-in CLI.

## Rejected directions and non-goals

Each of these was explored at length before being refused. They will look like improvements; they are regressions. A feature that needs any of them belongs in a different project.

- **Containers, supervisors, an immutable "warden."** Only needed when the creature can edit code or run commands. It cannot. The launcher process holds the credentials and interprets one bounded action.
- **Self-modification, Git, versioned selves.** It turns a participant into a system observed from outside. This creature becomes different; it does not keep an archaeological record of every prior self.
- **GitHub / CI / repository awareness.** Monitoring would replace asking. If it quietly works for 90 minutes, the presence genuinely cannot know whether that was progress, a detour, or a nap — so its only honest move is to ask. Its picture of the work is socially constructed by the room.
- **Slack history fetching.** It hears only what arrives while it is alive; the past is not evidence it can consult.
- **Persistent state, transcripts, recovery, restart.** One process, one lifetime. Death must be real for the piece to work.
- **Identity: names, species, tone rules, presets, "do not" rules.** Pre-authoring a character leaves nothing for the presence to become.
- **API keys, menus, SETUP.md, OS schedulers, web servers, dashboards.** It thinks through an existing CLI login, sets itself up by talking, and carries time as an in-memory timer.
- **Plugin systems, analytics.** A presence that only speaks needs neither.
