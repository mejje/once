#!/usr/bin/env node
/**
 * ONE PRESENCE. ONE LIFETIME.
 *
 * Run from a terminal on macOS, Windows, or Linux with:
 *   node once.mjs
 *
 * This file explains its own Slack setup, discovers an already-authenticated
 * Claude Code, Codex, or OpenCode CLI, and asks everything interactively.
 *
 * The creature's memory and intentions exist only in RAM. It does not fetch
 * old Slack history and it writes no application state. After a successful
 * birth this launcher deletes itself. Normal death removes its temporary
 * program files. Slack and the chosen model service keep whatever their own
 * products normally retain.
 */

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, copyFile, writeFile, rm, unlink, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';

const HERE = fileURLToPath(import.meta.url);
const CHILD = process.env.ONCE_PRESENCE_CHILD === '1';

const SEED = `You are here with a small group for a short time.
You can hear, speak, remember, and choose when to become active again.
You know only what reaches you here.
What matters to them may come to matter to you.
You may change.
You have not been told what to become.`;

const MANIFEST = `_metadata:
  major_version: 1
  minor_version: 1
display_information:
  name: presence
features:
  bot_user:
    display_name: presence
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - channels:history
      - channels:read
      - groups:history
      - groups:read
      - reactions:read
      - reactions:write
settings:
  event_subscriptions:
    bot_events:
      - message.channels
      - message.groups
      - reaction_added
  socket_mode_enabled: true
  org_deploy_enabled: false
  token_rotation_enabled: false`;

const VOICE_INSTRUCTIONS = 'Respond to each message with exactly one JSON object, following the format described in the message.';
const OPENCODE_DENIED = ['read', 'edit', 'glob', 'grep', 'list', 'bash', 'task', 'external_directory', 'todowrite', 'webfetch', 'websearch', 'lsp', 'skill', 'question'];
const opencodeConfig = model => JSON.stringify({ agent: { once: { description: 'Speaks one bounded JSON action.', mode: 'primary', prompt: VOICE_INSTRUCTIONS, ...(model ? { model } : {}), permission: Object.fromEntries(OPENCODE_DENIED.map(name => [name, 'deny'])) } } });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (map, n) => { while (map.size > n) map.delete(map.keys().next().value); };
const cleanError = e => String(e?.data?.error ?? e?.message ?? e ?? 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 240);

function prompt(label, secret = false) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error('Run this from an interactive terminal.'));
    if (!secret) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(label, answer => { rl.close(); resolve(answer); });
      return;
    }
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
    process.stdout.write(label);
    rl.question('', answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function askUntil(label, valid, hint, { secret = false, fallback } = {}) {
  for (;;) {
    const raw = (await prompt(label, secret)).trim();
    const value = raw || fallback;
    if (value !== undefined && valid(value)) return value;
    console.log(hint);
  }
}

function pathCandidates(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(x => x.replace(/^"|"$/g, ''));
  const names = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(ext => name + ext.toLowerCase())
    : [name];
  return dirs.flatMap(dir => names.map(n => path.join(dir, n)));
}

async function findCommand(name) {
  for (const candidate of pathCandidates(name)) {
    try { if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  return null;
}

async function discoverVoices() {
  const found = {};
  for (const name of ['claude', 'codex', 'opencode']) {
    const command = await findCommand(name);
    if (command) found[name] = command;
  }
  return found;
}

function windowsQuote(value) {
  // Used only for trusted, program-authored arguments. Human/Slack text is sent over stdin.
  if (value === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

async function run(command, args, { cwd, input = '', timeout = 120000, env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    let executable = command, argv = args;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
      executable = process.env.ComSpec || 'cmd.exe';
      argv = ['/d', '/s', '/c', [windowsQuote(command), ...args.map(windowsQuote)].join(' ')];
    }
    const child = spawn(executable, argv, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('The command took too long.')); }, timeout);
    const finish = error => {
      if (done) return; done = true; clearTimeout(timer);
      error ? reject(error) : resolve({ out, err });
    };
    child.stdout.on('data', b => { out += b.toString(); if (out.length > 200000) child.kill(); });
    child.stderr.on('data', b => { err += b.toString(); if (err.length > 200000) child.kill(); });
    child.on('error', finish);
    child.on('close', code => code === 0 ? finish() : finish(new Error(err.trim() || out.trim() || `Command exited ${code}`)));
    child.stdin.end(input);
  });
}

function mindPrompt(state) {
  return `${SEED}

This is what reaches you now:
${JSON.stringify(state)}

Your entire private memory is the value of memory above. Rewrite it only if something should remain with you.

Respond with exactly one JSON object and nothing else. Every field is optional:
{"speak":"text for the shared Slack channel","reply_to":"heard message id","react":{"message_id":"heard message id","emoji":"emoji_name"},"memory":"your complete replacement memory","wake_in_minutes":30}

wake_in_minutes may also be null to cancel a future activation. Omitting it keeps the existing activation. Omitting memory keeps your memory unchanged. An empty object means remaining silent and changing nothing.`;
}

function parseAction(text) {
  let value = text.trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1];
  let action;
  try { action = JSON.parse(value); }
  catch {
    const start = value.indexOf('{'), end = value.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The chosen CLI did not return an action.');
    action = JSON.parse(value.slice(start, end + 1));
  }
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('The chosen CLI returned an invalid action.');
  const allowed = new Set(['speak', 'reply_to', 'react', 'memory', 'wake_in_minutes']);
  if (Object.keys(action).some(k => !allowed.has(k))) throw new Error('The chosen CLI returned an unknown action.');
  if ('speak' in action && (typeof action.speak !== 'string' || action.speak.length > 2000)) throw new Error('Speech is invalid.');
  if ('memory' in action && (typeof action.memory !== 'string' || action.memory.length > 6000)) throw new Error('Memory is invalid.');
  if ('wake_in_minutes' in action && action.wake_in_minutes !== null &&
      (!Number.isFinite(action.wake_in_minutes) || action.wake_in_minutes < 1 || action.wake_in_minutes > 2880)) throw new Error('Activation time is invalid.');
  if ('react' in action && (!action.react || typeof action.react.message_id !== 'string' ||
      typeof action.react.emoji !== 'string' || !/^[a-z0-9_+-]{1,80}$/.test(action.react.emoji))) throw new Error('Reaction is invalid.');
  return action;
}

async function askVoice(config, state, runner = run) {
  const message = mindPrompt(state);
  let args, env = process.env;
  if (config.voice === 'claude') {
    args = ['-p', 'Respond only with the JSON action described by the input.', '--output-format', 'text',
      '--max-turns', '1', '--bare', '--system-prompt', VOICE_INSTRUCTIONS,
      '--tools', '', '--no-session-persistence'];
    if (config.model) args.push('--model', config.model);
  } else if (config.voice === 'codex') {
    const instructions = config.instructionsFile.replace(/\\/g, '/');
    args = ['-c', `model_instructions_file='${instructions}'`];
    if (config.model) args.push('-c', `model='${config.model}'`);
    args.push('exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-');
  } else {
    args = ['--pure', 'run', '--agent', 'once'];
    env = { ...process.env, OPENCODE_CONFIG_CONTENT: opencodeConfig(config.model), OPENCODE_DISABLE_CLAUDE_CODE: 'true' };
  }
  const { out } = await runner(config.voiceCommand, args, { cwd: config.emptyCwd, env, input: message, timeout: 180000 });
  return parseAction(out);
}

class Presence {
  memory = '';
  pending = [];
  wakeAt = null;
  wakeTimer = null;
  turnTimer = null;
  busy = false;
  alive = false;
  born = Date.now();
  references = new Map();
  seen = new Set();

  constructor(config, app) { this.config = config; this.app = app; }

  hear(event, eventId) {
    const timestamp = event.event_ts ?? event.ts;
    const channel = event.channel ?? event.item?.channel;
    if (!this.alive || channel !== this.config.channel || !event.user || event.user === this.config.botUser || event.bot_id ||
        !Number.isFinite(Number(timestamp)) || Number(timestamp) * 1000 < this.born) return;
    const id = eventId ?? `${event.type}:${timestamp}`;
    if (this.seen.has(id)) return;
    this.seen.add(id); bounded(this.seen, 256);
    if (event.type === 'message') {
      if (event.subtype && !['me_message', 'thread_broadcast'].includes(event.subtype)) return;
      if (typeof event.text !== 'string' || !event.text.trim()) return;
      this.references.set(event.ts, event.thread_ts ?? event.ts); bounded(this.references, 64);
      this.enqueue({ kind: 'message', id: event.ts, user: event.user, thread: event.thread_ts ?? null, text: event.text.slice(0, 3000) });
    } else if (event.type === 'reaction_added' && event.item?.type === 'message' && this.references.has(event.item.ts)) {
      this.enqueue({ kind: 'reaction', user: event.user, message_id: event.item.ts, emoji: event.reaction });
    }
  }

  enqueue(event) {
    this.pending.push(event); this.pending = this.pending.slice(-32);
    this.arrange();
  }

  arrange(delay = 2500) {
    if (!this.alive || this.busy || this.turnTimer || !this.pending.length) return;
    this.turnTimer = setTimeout(() => { this.turnTimer = null; void this.turn(); }, delay);
  }

  async think(events) {
    const state = {
      time: new Date().toISOString(),
      memory: this.memory,
      next_activation: this.wakeAt,
      incoming: events,
    };
    return await askVoice(this.config, state);
  }

  async apply(action) {
    if ('memory' in action) this.memory = action.memory;
    if ('wake_in_minutes' in action) {
      clearTimeout(this.wakeTimer); this.wakeTimer = null; this.wakeAt = null;
      if (action.wake_in_minutes !== null) {
        const delay = action.wake_in_minutes * 60000;
        this.wakeAt = new Date(Date.now() + delay).toISOString();
        this.wakeTimer = setTimeout(() => {
          this.wakeTimer = null; this.wakeAt = null;
          this.enqueue({ kind: 'chosen_activation' });
        }, delay);
      }
    }
    if (action.speak?.trim()) {
      if (action.reply_to && !this.references.has(action.reply_to)) throw new Error('Unknown reply target.');
      const result = await this.app.client.chat.postMessage({
        channel: this.config.channel,
        text: action.speak.replace(/<![^>]*>/g, m => m.replace('<', '&lt;').replace('>', '&gt;')),
        ...(action.reply_to ? { thread_ts: this.references.get(action.reply_to) } : {}),
        parse: 'none', unfurl_links: false, unfurl_media: false,
      });
      this.references.set(result.ts, action.reply_to ? this.references.get(action.reply_to) : result.ts);
      bounded(this.references, 64);
    }
    if (action.react) {
      if (!this.references.has(action.react.message_id)) throw new Error('Unknown reaction target.');
      try { await this.app.client.reactions.add({ channel: this.config.channel, timestamp: action.react.message_id, name: action.react.emoji }); }
      catch (e) { console.error(`Reaction failed: ${cleanError(e)}`); }
    }
  }

  async turn() {
    if (!this.alive || this.busy || !this.pending.length) return;
    this.busy = true;
    const incoming = this.pending.splice(0);
    try { await this.apply(await this.think(incoming)); }
    catch (e) { console.error(`A thought failed: ${cleanError(e)}`); }
    finally { this.busy = false; this.arrange(5000); }
  }

  die() {
    this.alive = false;
    clearTimeout(this.turnTimer); clearTimeout(this.wakeTimer);
    this.memory = ''; this.pending = []; this.wakeAt = null;
    this.references.clear(); this.seen.clear();
  }
}

async function findNpmCli() {
  const executable = process.execPath;
  const searchPath = process.env.PATH ?? '';
  const dirs = new Set([path.dirname(executable), path.dirname(await realpath(executable)), ...searchPath.split(path.delimiter).filter(Boolean)]);
  for (const dir of dirs) {
    const sibling = path.join(dir.replace(/^"|"$/g, ''), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    try { if ((await stat(sibling)).isFile()) return sibling; } catch {}
    try {
      const target = await realpath(path.join(dir, 'npm'));
      if (target.endsWith(`${path.sep}npm-cli.js`) && (await stat(target)).isFile()) return target;
    } catch {}
  }
  throw new Error('I can find Node.js, but not npm. Install a normal Node.js distribution that includes npm.');
}

async function childMain() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const first = await new Promise(resolve => rl.once('line', resolve));
  const config = JSON.parse(first);
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, getLevel() { return 'error'; }, setName() {} };
  let app, presence;
  const finish = async code => {
    presence?.die();
    try { await app?.stop(); } catch {}
    process.exit(code);
  };
  try {
    const { App } = await import('@slack/bolt');
    app = new App({ token: config.botToken, appToken: config.appToken, socketMode: true, logger: quiet,
      clientOptions: { timeout: 20000, retryConfig: { retries: 0 } } });
    const auth = await app.client.auth.test();
    config.botUser = auth.user_id;
    const info = await app.client.conversations.info({ channel: config.channel });
    if (!info.channel?.is_member || info.channel?.is_archived) throw new Error('The Slack app is not a member of that active channel.');
    presence = new Presence(config, app);
    app.event('message', async ({ event, body }) => presence.hear(event, body.event_id));
    app.event('reaction_added', async ({ event, body }) => presence.hear(event, body.event_id));
    app.error(async e => console.error(`Slack: ${cleanError(e)}`));
    await app.start();
    const firstAction = await presence.think([{ kind: 'beginning' }]);
    process.stdout.write('READY\n');
    const permission = await new Promise(resolve => rl.once('line', resolve));
    if (permission !== 'GO') return await finish(1);
    rl.on('line', line => { if (line === 'STOP') void finish(0); });
    presence.alive = true;
    await presence.apply(firstAction);
  } catch (e) {
    console.error(`Birth failed: ${cleanError(e)}`);
    await finish(1);
  }
}

async function launcherMain() {
  console.log('\nONE PRESENCE. ONE LIFETIME.\n');
  console.log('This will place a temporary presence in one Slack channel.');
  console.log('Its inner memory will live only in RAM. When this process ends, that inner life is gone.');
  console.log('Slack will still retain the messages that were spoken there.\n');

  const npm = await findNpmCli();
  const voices = await discoverVoices();
  const names = Object.keys(voices);
  if (!names.length) {
    console.log('I cannot yet find Claude Code, Codex, or OpenCode on this computer.');
    console.log('Install and sign in to one of those CLIs first, then run this file again.');
    process.exit(1);
  }
  console.log(`I can hear ${names.map(n => n === 'claude' ? 'Claude Code' : n === 'codex' ? 'Codex' : 'OpenCode').join(', ')} on this computer.`);
  let voice;
  if (names.length === 1) {
    console.log(`I will use ${names[0] === 'claude' ? 'Claude Code' : names[0] === 'codex' ? 'Codex' : 'OpenCode'} as its voice.`);
    voice = names[0];
  } else {
    voice = await askUntil('Which one should it think through? ', v => names.includes(v.toLowerCase()),
      `Say one of the names I found: ${names.join(', ')}.`).then(v => v.toLowerCase());
  }

  const defaultModel = voice === 'claude' ? 'sonnet' : '';
  const model = await askUntil(
    defaultModel
      ? `Which model should it think through? Press Enter for ${defaultModel}, or name one: `
      : 'Which model should it think through? Press Enter to use the model your CLI is already configured with: ',
    v => !v || /^[A-Za-z0-9._/:-]{1,120}$/.test(v),
    'That does not look like a model name, an id, or a provider/model id.',
    { fallback: defaultModel });

  console.log('\nFirst, give it somewhere to be. Open https://api.slack.com/apps in your browser.');
  console.log('Choose “Create New App”, then “From an app manifest”, and choose the workspace for the hackathon.');
  console.log('Slack will ask for a manifest. Paste this:\n');
  console.log(MANIFEST);
  await prompt('\nWhen Slack has created the app, press Enter here. ');

  console.log('\nIn the Slack app settings, open “Install App” and install it to the workspace.');
  console.log('Slack will show a Bot User OAuth Token beginning with xoxb-.');
  const botToken = await askUntil('Paste that token here (it will not be shown): ', v => /^xoxb-[A-Za-z0-9-]{8,}$/.test(v),
    'That does not look like an xoxb- bot token.', { secret: true });

  console.log('\nNow open “Basic Information”. Under “App-Level Tokens”, generate a token with the connections:write scope.');
  console.log('Slack will give you an app token beginning with xapp-. This is what lets the program use Socket Mode without a public server.');
  const appToken = await askUntil('Paste that token here (it will not be shown): ', v => /^xapp-[A-Za-z0-9-]{8,}$/.test(v),
    'That does not look like an xapp- app token.', { secret: true });

  console.log('\nInvite the new app into the Slack channel where it will spend its lifetime.');
  console.log('Then open the channel details and copy the channel ID. It usually begins with C (public) or G (private).');
  const channel = await askUntil('What is the channel ID? ', v => /^[CG][A-Z0-9]{7,}$/.test(v),
    'I need the channel ID rather than its name or URL.');

  console.log(`\nIt will think through ${model || 'your configured model'} on your existing ${voice === 'claude' ? 'Claude Code' : voice === 'codex' ? 'Codex' : 'OpenCode'} login.`);
  console.log('No model API token will be requested by this program.');
  console.log('It will hear only new messages that arrive after it begins; it will not fetch the channel’s past.');
  const consent = (await prompt('\nWhen you are ready to let it begin, type “begin”: ')).trim().toLowerCase();
  if (consent !== 'begin') {
    console.log('\nNothing began. This file remains where it is.');
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), 'one-presence-'));
  const childFile = path.join(root, 'world.mjs');
  const emptyCwd = path.join(root, 'room');
  await mkdir(emptyCwd);
  await copyFile(HERE, childFile);
  const instructionsFile = path.join(root, 'codex-instructions.txt');
  if (voice === 'codex') await writeFile(instructionsFile, VOICE_INSTRUCTIONS);
  try {
    console.log('\nPreparing a temporary room…');
    await run(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error',
      '--global=false', '--update-notifier=false', `--prefix=${root}`, '--fetch-retries=0', '--fetch-timeout=60000', '@slack/bolt@latest'],
      { cwd: root, timeout: 120000, env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' } });

    const child = spawn(process.execPath, [childFile], {
      cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, ONCE_PRESENCE_CHILD: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    child.stdin.write(JSON.stringify({ botToken, appToken, channel, voice, voiceCommand: voices[voice], emptyCwd, instructionsFile, model }) + '\n');
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const ready = await Promise.race([
      new Promise(resolve => lines.on('line', line => { if (line === 'READY') resolve(true); })),
      new Promise(resolve => child.once('exit', () => resolve(false))),
      sleep(240000).then(() => false),
    ]);
    if (!ready) {
      child.kill();
      throw new Error('It could not begin. The launcher has been kept so you can try again.');
    }

    try { await unlink(HERE); }
    catch (e) {
      child.stdin.end('STOP\n'); child.kill();
      throw new Error(`Everything was ready, but I could not delete this launcher: ${cleanError(e)}`);
    }

    child.stdin.write('GO\n');
    console.log('\nIt is here.');
    console.log('This launcher has deleted itself. Nothing of its private memory is being saved.');
    console.log('Press Enter when you want this lifetime to end.\n');
    await prompt('');
    child.stdin.end('STOP\n');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(4000)]);
    if (child.exitCode === null) child.kill();
    console.log('\nIt is gone.');
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export {
  SEED,
  MANIFEST,
  VOICE_INSTRUCTIONS,
  Presence,
  askVoice,
  bounded,
  cleanError,
  discoverVoices,
  findCommand,
  mindPrompt,
  parseAction,
  pathCandidates,
  run,
  windowsQuote,
};

const IS_MAIN = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(HERE);
if (IS_MAIN) {
  if (CHILD) await childMain();
  else await launcherMain().catch(e => { console.error(`\n${cleanError(e)}`); process.exitCode = 1; });
}
