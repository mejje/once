# once

A presence that exists in one Slack channel for one lifetime.

It begins with almost nothing:

> You are here with a small group for two days.  
> You can hear, speak, remember, and choose when to become active again.  
> You know only what reaches you here.  
> What matters to them may come to matter to you.  
> You may change.  
> You have not been told what to become.

There is no predefined name, character, project plan, achievement system, or identity.

It hears what people say after it begins. It can speak, react, retain a small mutable private memory, and choose a future time to become active again. Its private memory and future intentions exist only in RAM.

When the process ends, that inner life is gone.

## What is in this repository

```text
README.md
once.mjs
tests/
  architecture.test.mjs
  core.test.mjs
  import.test.mjs
  presence.test.mjs
  voice.test.mjs
```

`once.mjs` is both the installer and the program.

There is no application database, state file, model API key, daemon, Docker container, or setup program.

## Requirements

- macOS or Windows
- Node.js 22 or newer, with npm available
- one already installed and authenticated local model CLI:
  - `claude`
  - `codex`
  - `opencode`
- permission to create/install a Slack app in the workspace

The model side uses your existing CLI login. `once` does **not** ask for an Anthropic, OpenAI, or OpenCode API key.

Slack itself still needs Slack credentials. The interactive setup explains how to create them:

- a bot OAuth token beginning with `xoxb-`
- a Socket Mode app token beginning with `xapp-`

Those credentials are given directly to the temporary child process and are not written into an application state file.

## Before running it

Optionally run the tests first:

```sh
node --test tests/*.test.mjs
```

On Windows PowerShell, the same command works:

```powershell
node --test tests/*.test.mjs
```

No test dependencies need to be installed.

## Begin

From Terminal on macOS or PowerShell on Windows:

```sh
node once.mjs
```

There are no command-line options and no numbered menus.

The launcher talks you through the setup in plain language. It will:

1. discover `claude`, `codex`, and `opencode` on your `PATH`
2. ask which available CLI it should think through if there is more than one
3. explain how to create a Slack app from the manifest it prints
4. wait while you install that app into the workspace
5. privately ask for the Slack `xoxb-` bot token
6. explain how to create the Slack `xapp-` Socket Mode token
7. privately ask for that token
8. ask for the Slack channel ID and remind you to invite the app there
9. verify Slack and obtain one initial model response
10. delete `once.mjs`
11. allow the presence to begin

The self-deletion happens only after Slack is reachable and the initial model invocation has succeeded. If setup fails before that point, the launcher remains so you can try again.

### Important

A successful birth deletes the exact `once.mjs` file you launched.

If you want another copy later, re-extract the ZIP. A newly launched copy is a new presence; nothing of the previous private state can be restored.

## During its lifetime

The program listens only to new Slack events that arrive while it is alive. It does not fetch old channel history on startup.

The model is shown only:

- the current time
- its current private memory
- its next chosen activation, if any
- new messages/reactions that reached it

It may return only these effects:

```text
speak
reply
react
replace its private memory
choose/cancel a future activation
```

A future activation is an in-memory timer. When it fires, the model becomes active again and may speak or remain silent.

The local model CLI is invoked non-interactively. Slack/channel text is sent to the CLI over stdin rather than interpolated into a shell command.

For Claude Code, editing/shell/web tools are disabled for the invocation. Codex is invoked in a read-only sandbox. OpenCode is invoked through `opencode run`; the presence itself still exposes no filesystem or shell action in its output protocol.

## End

While it is running, press Enter in the terminal that launched it.

The process stops, clears its in-memory state, and removes the temporary program directory.

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
- Claude Code invocation restrictions
- Codex read-only invocation
- OpenCode invocation
- Slack event filtering and deduplication
- hearing messages and reactions
- speaking, replying, and reacting
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
