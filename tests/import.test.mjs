import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Importing the implementation for tests must not start the interactive launcher.
test('once.mjs is import-safe and exports its testable physics', async () => {
  const mod = await import(pathToFileURL(path.resolve('once.mjs')).href + `?t=${Date.now()}`);
  for (const name of ['Presence', 'parseAction', 'mindPrompt', 'askVoice', 'run']) {
    assert.ok(mod[name], `${name} should be exported`);
  }
});
