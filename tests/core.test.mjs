import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SEED,
  MANIFEST,
  VOICE_INSTRUCTIONS,
  bounded,
  cleanError,
  discoverVoices,
  findCommand,
  mindPrompt,
  parseAction,
  pathCandidates,
  readDevConfig,
  run,
  windowsQuote,
} from '../once.mjs';

test('seed is deliberately minimal and identity-free', () => {
  assert.equal(SEED, `You are here with a small group for a short time.
You can hear, speak, remember, and choose when to become active again.
You know only what reaches you here.
What matters to them may come to matter to you.
You may change.
You have not been told what to become.`);
  assert.doesNotMatch(SEED, /raven|rook|coach|manager|assistant|identity/i);
});

test('voice instructions are literal protocol text without identity', () => {
  assert.equal(VOICE_INSTRUCTIONS, 'Respond to each message with exactly one JSON object, following the format described in the message.');
  assert.doesNotMatch(VOICE_INSTRUCTIONS, /assistant|personality|character|tone|you are/i);
});

test('manifest enables Socket Mode and the required channel capabilities', () => {
  assert.match(MANIFEST, /socket_mode_enabled: true/);
  for (const scope of ['chat:write', 'chat:write.customize', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'reactions:read', 'reactions:write']) {
    assert.match(MANIFEST, new RegExp(scope.replace(':', '\\:')));
  }
  assert.match(MANIFEST, /name: once/);
  assert.match(MANIFEST, /display_name: once/);
  assert.match(MANIFEST, /message\.channels/);
  assert.match(MANIFEST, /message\.groups/);
  assert.match(MANIFEST, /reaction_added/);
});

test('mindPrompt exposes only current state and action schema', () => {
  const prompt = mindPrompt({
    time: '2030-01-01T00:00:00.000Z',
    memory: 'something stayed',
    next_activation: null,
    incoming: [{ kind: 'message', text: 'hello' }],
  });
  assert.match(prompt, /something stayed/);
  assert.match(prompt, /hello/);
  assert.match(prompt, /"name"/);
  assert.match(prompt, /wake_in_minutes/);
  assert.match(prompt, /complete replacement memory/);
  assert.match(prompt, /remaining silent and changing nothing/);
});

test('mindPrompt stops offering a name once one is chosen', () => {
  const prompt = mindPrompt({
    time: '2030-01-01T00:00:00.000Z',
    memory: '',
    name: 'Ash',
    next_activation: null,
    incoming: [],
  });
  assert.doesNotMatch(prompt, /chosen only once/);
  assert.match(prompt, /Ash/);
});

test('parseAction accepts an empty action', () => {
  assert.deepEqual(parseAction('{}'), {});
});

test('parseAction accepts fenced JSON', () => {
  assert.deepEqual(parseAction('```json\n{"speak":"hi"}\n```'), { speak: 'hi' });
});

test('parseAction can recover a JSON object surrounded by CLI noise', () => {
  assert.deepEqual(parseAction('note\n{"memory":"x"}\nend'), { memory: 'x' });
});

test('parseAction validates all supported actions', () => {
  const action = parseAction(JSON.stringify({
    speak: 'hello',
    reply_to: '1.2',
    react: { message_id: '1.2', emoji: 'sparkles' },
    name: 'Ash',
    memory: 'kept',
    wake_in_minutes: 17,
  }));
  assert.equal(action.speak, 'hello');
  assert.equal(action.name, 'Ash');
  assert.equal(action.wake_in_minutes, 17);
});

test('parseAction rejects unknown powers', () => {
  assert.throws(() => parseAction('{"browse":"https://example.com"}'), /unknown action/);
});

test('parseAction rejects oversized speech', () => {
  assert.throws(() => parseAction(JSON.stringify({ speak: 'x'.repeat(2001) })), /Speech is invalid/);
});

test('parseAction rejects oversized memory', () => {
  assert.throws(() => parseAction(JSON.stringify({ memory: 'x'.repeat(6001) })), /Memory is invalid/);
});

test('parseAction constrains the displayed name', () => {
  assert.equal(parseAction('{"name":null}').name, null);
  assert.equal(parseAction('{"name":"Ash"}').name, 'Ash');
  assert.throws(() => parseAction('{"name":""}'), /Name is invalid/);
  assert.throws(() => parseAction('{"name":"<script>"}'), /Name is invalid/);
  assert.throws(() => parseAction(JSON.stringify({ name: 'x'.repeat(41) })), /Name is invalid/);
});

test('parseAction constrains future activations', () => {
  assert.equal(parseAction('{"wake_in_minutes":null}').wake_in_minutes, null);
  assert.throws(() => parseAction('{"wake_in_minutes":0}'), /Activation time is invalid/);
  assert.throws(() => parseAction('{"wake_in_minutes":2881}'), /Activation time is invalid/);
});

test('parseAction constrains emoji syntax', () => {
  assert.throws(() => parseAction('{"react":{"message_id":"1","emoji":"<script>"}}'), /Reaction is invalid/);
});

test('parseAction strips colons from an emoji name', () => {
  assert.equal(parseAction('{"react":{"message_id":"1","emoji":":eyes:"}}').react.emoji, 'eyes');
});

test('bounded trims oldest entries', () => {
  const map = new Map([['a', 1], ['b', 2], ['c', 3]]);
  bounded(map, 2);
  assert.deepEqual([...map.keys()], ['b', 'c']);
});

test('cleanError prefers Slack-style data.error and removes newlines', () => {
  assert.equal(cleanError({ data: { error: 'bad\nthing' } }), 'bad thing');
});

test('windowsQuote leaves simple trusted arguments alone', () => {
  assert.equal(windowsQuote('hello-world'), 'hello-world');
  assert.equal(windowsQuote('two words'), '"two words"');
  assert.equal(windowsQuote(''), '""');
});

test('pathCandidates uses PATH', () => {
  const old = process.env.PATH;
  process.env.PATH = [path.join(tmpdir(), 'one-a'), path.join(tmpdir(), 'one-b')].join(path.delimiter);
  try {
    const candidates = pathCandidates('claude');
    assert.ok(candidates.length >= 2);
    assert.ok(candidates.some(x => x.includes('one-a')));
  } finally {
    process.env.PATH = old;
  }
});

test('findCommand and discoverVoices inspect PATH without invoking commands', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'once-voice-test-'));
  const old = process.env.PATH;
  const oldExt = process.env.PATHEXT;
  const cliFile = path.join(dir, process.platform === 'win32' ? 'opencode-cli.cmd' : 'opencode-cli');
  const uiFile = path.join(dir, process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  try {
    process.env.PATH = dir;
    if (process.platform === 'win32') {
      process.env.PATHEXT = '.CMD';
      await writeFile(path.join(dir, 'claude.cmd'), '@echo off\r\n');
      await writeFile(cliFile, '@echo off\r\n');
      await writeFile(uiFile, '@echo off\r\n');
    } else {
      await writeFile(path.join(dir, 'claude'), '#!/bin/sh\nexit 0\n');
      await writeFile(cliFile, '#!/bin/sh\nexit 0\n');
      await writeFile(uiFile, '#!/bin/sh\nexit 0\n');
      await chmod(path.join(dir, 'claude'), 0o755);
      await chmod(cliFile, 0o755);
      await chmod(uiFile, 0o755);
    }
    assert.ok(await findCommand('claude'));
    const voices = await discoverVoices();
    assert.ok(voices.claude);
    assert.equal(voices.codex, undefined);
    assert.ok(voices.opencode.includes('opencode-cli'));
    await rm(cliFile);
    const fallback = await discoverVoices();
    assert.ok(fallback.opencode.includes('opencode'));
  } finally {
    process.env.PATH = old;
    process.env.PATHEXT = oldExt;
    await rm(dir, { recursive: true, force: true });
  }
});

test('readDevConfig ignores an environment without developer variables', () => {
  assert.equal(readDevConfig({}), null);
});

test('readDevConfig parses a complete developer environment', () => {
  const config = readDevConfig({
    ONCE_VOICE: 'codex',
    ONCE_MODEL: 'gpt-6.1-sol',
    ONCE_BOT_TOKEN: 'xoxb-12345678',
    ONCE_APP_TOKEN: 'xapp-12345678',
    ONCE_CHANNEL: 'C12345678',
  });
  assert.deepEqual(config, {
    voice: 'codex',
    model: 'gpt-6.1-sol',
    botToken: 'xoxb-12345678',
    appToken: 'xapp-12345678',
    channel: 'C12345678',
  });
});

test('readDevConfig rejects incomplete or malformed developer environments', () => {
  assert.throws(() => readDevConfig({ ONCE_VOICE: 'claude' }), /Developer mode needs/);
  assert.throws(() => readDevConfig({ ONCE_VOICE: 'vim', ONCE_BOT_TOKEN: 'xoxb-12345678', ONCE_APP_TOKEN: 'xapp-12345678', ONCE_CHANNEL: 'C12345678' }), /ONCE_VOICE/);
  assert.throws(() => readDevConfig({ ONCE_VOICE: 'claude', ONCE_BOT_TOKEN: 'nope', ONCE_APP_TOKEN: 'xapp-12345678', ONCE_CHANNEL: 'C12345678' }), /ONCE_BOT_TOKEN/);
  assert.throws(() => readDevConfig({ ONCE_VOICE: 'claude', ONCE_BOT_TOKEN: 'xoxb-12345678', ONCE_APP_TOKEN: 'xapp-12345678', ONCE_CHANNEL: 'nope' }), /ONCE_CHANNEL/);
  assert.throws(() => readDevConfig({ ONCE_VOICE: 'claude', ONCE_MODEL: 'has space', ONCE_BOT_TOKEN: 'xoxb-12345678', ONCE_APP_TOKEN: 'xapp-12345678', ONCE_CHANNEL: 'C12345678' }), /ONCE_MODEL/);
});

test('run sends arbitrary text over stdin rather than shell interpolation', async () => {
  const hostile = 'hello; echo SHOULD_NOT_EXECUTE && $(whoami)';
  const script = `process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>process.stdout.write(s));`;
  const result = await run(process.execPath, ['-e', script], { input: hostile, timeout: 5000 });
  assert.equal(result.out, hostile);
});
