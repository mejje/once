import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../once.mjs', import.meta.url), 'utf8');

test('the creature does not fetch Slack history on birth', () => {
  assert.doesNotMatch(source, /conversations\.history/);
  assert.doesNotMatch(source, /conversations\.replies/);
});

test('the model side has no arbitrary browsing or shell tool surface', () => {
  assert.match(source, /--disallowedTools[^\n]*Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task/);
  assert.match(source, /--sandbox', 'read-only'/);
  assert.doesNotMatch(source, /https?:\/\/[^'"`\s]+.*incoming/);
});

test('private memory is not serialized to a state file', () => {
  assert.doesNotMatch(source, /state\.json/i);
  assert.doesNotMatch(source, /writeFile\s*\(/);
  assert.doesNotMatch(source, /appendFile\s*\(/);
  assert.doesNotMatch(source, /createWriteStream\s*\(/);
  assert.doesNotMatch(source, /sqlite|leveldb|redis/i);
});

test('the launcher uses a temporary room and removes it on normal exit', () => {
  assert.match(source, /mkdtemp\(path\.join\(tmpdir\(\), 'one-presence-'\)\)/);
  assert.match(source, /rm\(root, \{ recursive: true, force: true \}\)/);
});

test('the launcher deletes itself only after the child reports READY', () => {
  const ready = source.indexOf("if (!ready)");
  const deletion = source.indexOf('await unlink(HERE)');
  const go = source.indexOf("child.stdin.write('GO\\n')");
  assert.ok(ready >= 0 && deletion > ready && go > deletion);
});

test('the presence has no automatic restart loop', () => {
  assert.doesNotMatch(source, /restart\s*:/i);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\).*childMain/s);
});
