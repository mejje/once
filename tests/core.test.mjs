import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SEED,
  MANIFEST,
  bounded,
  cleanError,
  discoverVoices,
  findCommand,
  mindPrompt,
  parseAction,
  pathCandidates,
  run,
  windowsQuote,
} from '../once.mjs';

test('seed is deliberately minimal and identity-free', () => {
  assert.equal(SEED, `You are here with a small group for two days.
You can hear, speak, remember, and choose when to become active again.
You know only what reaches you here.
What matters to them may come to matter to you.
You may change.
You have not been told what to become.`);
  assert.doesNotMatch(SEED, /raven|rook|coach|manager|assistant|identity/i);
});

test('manifest enables Socket Mode and the required channel capabilities', () => {
  assert.match(MANIFEST, /socket_mode_enabled: true/);
  for (const scope of ['chat:write', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'reactions:read', 'reactions:write']) {
    assert.match(MANIFEST, new RegExp(scope.replace(':', '\\:')));
  }
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
  assert.match(prompt, /wake_in_minutes/);
  assert.match(prompt, /complete replacement memory/);
  assert.match(prompt, /remaining silent and changing nothing/);
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
    memory: 'kept',
    wake_in_minutes: 17,
  }));
  assert.equal(action.speak, 'hello');
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

test('parseAction constrains future activations', () => {
  assert.equal(parseAction('{"wake_in_minutes":null}').wake_in_minutes, null);
  assert.throws(() => parseAction('{"wake_in_minutes":0}'), /Activation time is invalid/);
  assert.throws(() => parseAction('{"wake_in_minutes":2881}'), /Activation time is invalid/);
});

test('parseAction constrains emoji syntax', () => {
  assert.throws(() => parseAction('{"react":{"message_id":"1","emoji":"<script>"}}'), /Reaction is invalid/);
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
  try {
    process.env.PATH = dir;
    if (process.platform === 'win32') {
      process.env.PATHEXT = '.CMD';
      await writeFile(path.join(dir, 'claude.cmd'), '@echo off\r\n');
    } else {
      await writeFile(path.join(dir, 'claude'), '#!/bin/sh\nexit 0\n');
      await chmod(path.join(dir, 'claude'), 0o755);
    }
    assert.ok(await findCommand('claude'));
    const voices = await discoverVoices();
    assert.ok(voices.claude);
    assert.equal(voices.codex, undefined);
  } finally {
    process.env.PATH = old;
    process.env.PATHEXT = oldExt;
    await rm(dir, { recursive: true, force: true });
  }
});

test('run sends arbitrary text over stdin rather than shell interpolation', async () => {
  const hostile = 'hello; echo SHOULD_NOT_EXECUTE && $(whoami)';
  const script = `process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>process.stdout.write(s));`;
  const result = await run(process.execPath, ['-e', script], { input: hostile, timeout: 5000 });
  assert.equal(result.out, hostile);
});
