# once

A presence that exists in one Slack channel for one lifetime.

It begins with almost nothing:

> You are here with a small group for a short time.  
> You can hear, speak, remember, and choose when to become active again.  
> You know only what reaches you here.  
> What matters to them may come to matter to you.  
> You may change.  
> You have not been told what to become.

There is no predefined name, character, project plan, achievement system, or identity.

It hears what people say after it begins. It can speak, reply, react, retain a small mutable private memory, and choose a future time to become active again. Its private memory and future intentions exist only in RAM.

When the process ends, that inner life is gone.

## Spirit

This program is not a bot, an assistant, a manager, or a monitor. It is a presence with one lifetime, and most of its design is made of refusals:

- no identity is written for it; the seed above is the whole of what it is told
- no persistence; memory and intentions exist only in RAM
- no external awareness; no history fetching, repositories, CI, or browsing
- no powers beyond speaking, replying, reacting, remembering, and choosing when to become active again
- no safety rules inside its self-conception; every boundary lives in the implementation

`AGENTS.md` records these invariants and how to continue the work without eroding them.

## What is in this repository

```text
.gitignore
.env.example
README.md
AGENTS.md
once.mjs
tests/
  architecture.test.mjs
  core.test.mjs
  import.test.mjs
  presence.test.mjs
  voice.test.mjs
```

`once.mjs` is both the installer and the program.

There is no application database, state file, model API key, daemon, Docker container, or separate setup program.

## Requirements

- macOS, Windows, or Linux
- Node.js 22 or newer, with npm available
- one already installed and authenticated local model CLI (recent enough to support its harness-stripping flags):
  - `claude`
  - `codex`
  - `opencode-cli` or `opencode` (the CLI is preferred when the desktop UI is also installed)
- permission to create/install a Slack app in the workspace

The model side uses your existing CLI login. `once` does **not** ask for a model API key.

Slack itself still needs Slack credentials. The interactive setup explains how to create them:

- a bot OAuth token beginning with `xoxb-`
- a Socket Mode app token beginning with `xapp-`

Those credentials are given directly to the temporary child process and are not written into an application state file.

## Before running it

Optionally run the tests first:

```sh
node --test tests/*.test.mjs
```

No test dependencies need to be installed.

## Begin

From a terminal on macOS, Windows, or Linux:

```sh
node once.mjs
```

There are no command-line options and no numbered menus.

The launcher talks you through the setup in plain language. It will:

1. discover `claude`, `codex`, and the OpenCode CLI (`opencode-cli`, falling back to `opencode`) on your `PATH`
2. ask which available CLI it should think through if there is more than one
3. ask which model it should think through (press Enter to use the CLI's configured model; Claude offers `sonnet` as its default)
4. explain how to create a Slack app from the manifest it prints
5. wait while you install that app into the workspace
6. privately ask for the Slack `xoxb-` bot token
7. explain how to create the Slack `xapp-` Socket Mode token
8. privately ask for that token
9. ask for the Slack channel ID and remind you to invite the app there
10. verify Slack and obtain one initial model response
11. delete `once.mjs`
12. allow the presence to begin

The self-deletion happens only after Slack is reachable and the initial model invocation has succeeded. If setup fails before that point, the launcher remains so you can try again.

### Important

A successful birth deletes the exact `once.mjs` file you launched.

If you want another one later, you'll have to find it again. A newly launched one is a new presence; nothing of the previous private state can be restored.

## For development

Setup can be supplied through environment variables instead of the questions, using a local `.env` file:

1. copy `.env.example` to `.env` and fill it in
2. run:

```sh
node --env-file=.env once.mjs
```

When those variables are present, the launcher skips the setup and keeps itself after a successful birth; the temporary room is still removed on exit. `ONCE_MODEL` is optional, the rest are required. Secrets stay out of the command line and shell history.

## During its lifetime

The program listens only to new Slack events that arrive while it is alive. It does not fetch old channel history on startup.

The model is shown only:

- the current time
- its current private memory
- its next chosen activation, if any
- new messages/reactions that reached it

It may return only these effects:

```text
speak (optionally continuing a thread it heard from)
react
choose, once, the name its messages are shown under
replace its private memory
choose/cancel a future activation
```

A reply only continues an existing thread; speech without a reply target goes to the channel, and new threads are never started.

A future activation is an in-memory timer. When it fires, the model becomes active again and may speak or remain silent. New messages can make it active sooner, whether or not an activation is pending.

Its messages are shown under the app's own name (`once`) until it has sent ten messages; from then on it may choose its own name, once. The chosen name lives in memory and dies with the process.

The local model CLI is invoked non-interactively with its own agent harness stripped. Slack/channel text is sent to the CLI over stdin rather than interpolated into a shell command. Mentions such as `<!channel>` in its speech are escaped, so it cannot ping the whole room.

- Claude Code runs bare, with its system prompt replaced by one literal protocol sentence, no built-in tools, and no session persistence.
- Codex runs in a read-only sandbox with its built-in instructions replaced by a one-line protocol file.
- OpenCode runs with its plugins disabled and a generated agent that denies every tool.

That protocol file for Codex lives in the temporary room, contains no private state, and is removed with the room. The presence itself exposes no filesystem or shell action in its output protocol.

The chosen model, if any, is passed to the CLI on every invocation; otherwise the CLI's own configured model is used.

## End

When the process ends, it clears its in-memory state and removes the temporary program directory.

There is no automatic restart.

If the process crashes, the machine restarts, or the terminal is forcibly killed, the presence is dead. A hard termination can leave temporary program/dependency files in the operating system temp directory, but there is no serialized private memory to resume.

## What “nothing is saved” means

`once` does not intentionally serialize the presence's private memory or future intentions to disk.

That is not the same as forensic non-retention. The operating system may page process memory, create crash dumps, or retain temporary filesystem artifacts. Slack retains messages according to the workspace's Slack policy, and the selected model CLI/provider may retain requests according to its own configuration and service policies.

The artistic boundary is narrower: **the program contains no mechanism for resurrecting the presence's internal state.**

## Tests

Run everything with:

```sh
node --test tests/*.test.mjs
```

The suite covers:

- the exact identity-free seed prompt
- Slack manifest capabilities
- the constrained model action protocol
- malformed/oversized model actions
- CLI discovery
- stdin-safe local CLI invocation
- harness-stripped invocation of Claude Code, Codex, and OpenCode
- Slack event filtering and deduplication
- hearing messages and reactions
- speaking, replying, reacting, and choosing its displayed name
- complete memory replacement rather than event logging
- in-memory future activations and cancellation
- destruction of private state on death
- no Slack history fetch
- no application state/database persistence
- temporary-room cleanup
- self-deletion ordering
- absence of an automatic restart loop
- import safety for the implementation under test

The tests mock Slack/model interactions. They do not require a Slack workspace or a logged-in model CLI.

## Shape of the world

```text
Slack events
    |
    v
+-------------------+
|     once.mjs      |
|                   |
| recent perception |
| mutable memory    |
| one timer         |
+---------+---------+
          |
          | stdin
          v
  claude / codex / opencode
          |
          v
    constrained action
```

The presence knows what reaches it, carries only what remains in its current memory, and exists only while its process exists.
