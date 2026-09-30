import test from 'node:test';
import assert from 'node:assert/strict';
import { askVoice } from '../once.mjs';

const state = {
  time: '2030-01-01T00:00:00.000Z',
  memory: '',
  next_activation: null,
  incoming: [{ kind: 'message', id: '1', user: 'U1', text: 'hello' }],
};

function capture(output = '{}') {
  const calls = [];
  return {
    calls,
    runner: async (...args) => {
      calls.push(args);
      return { out: output, err: '' };
    },
  };
}

test('Claude Code is invoked non-interactively with tools disabled', async () => {
  const c = capture('{"speak":"hello"}');
  const action = await askVoice({ voice: 'claude', voiceCommand: '/cli/claude', emptyCwd: '/empty' }, state, c.runner);
  assert.equal(action.speak, 'hello');
  const [command, args, options] = c.calls[0];
  assert.equal(command, '/cli/claude');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--permission-mode'));
  assert.ok(args.includes('plan'));
  assert.ok(args.includes('--disallowedTools'));
  assert.match(args[args.indexOf('--disallowedTools') + 1], /Bash/);
  assert.equal(options.cwd, '/empty');
  assert.match(options.input, /You are here with a small group/);
  assert.doesNotMatch(args.join(' '), /hello/);
});

test('Codex is invoked in a read-only sandbox and receives the prompt on stdin', async () => {
  const c = capture('{"memory":"kept"}');
  const action = await askVoice({ voice: 'codex', voiceCommand: '/cli/codex', emptyCwd: '/empty' }, state, c.runner);
  assert.equal(action.memory, 'kept');
  const [, args, options] = c.calls[0];
  assert.deepEqual(args, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
  assert.match(options.input, /"incoming"/);
});

test('OpenCode uses run mode and receives the prompt on stdin', async () => {
  const c = capture('{"wake_in_minutes":30}');
  const action = await askVoice({ voice: 'opencode', voiceCommand: '/cli/opencode', emptyCwd: '/empty' }, state, c.runner);
  assert.equal(action.wake_in_minutes, 30);
  const [, args, options] = c.calls[0];
  assert.deepEqual(args, ['run']);
  assert.match(options.input, /wake_in_minutes/);
});

test('askVoice rejects non-action output from the local CLI', async () => {
  const c = capture('I would like to say hello.');
  await assert.rejects(() => askVoice({ voice: 'codex', voiceCommand: 'codex', emptyCwd: '/empty' }, state, c.runner), /did not return an action/);
});
