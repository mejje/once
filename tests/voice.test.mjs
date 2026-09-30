import test from 'node:test';
import assert from 'node:assert/strict';
import { askVoice, VOICE_INSTRUCTIONS } from '../once.mjs';

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

test('Claude Code is invoked bare with its own prompt and tools removed', async () => {
  const c = capture('{"speak":"hello"}');
  const action = await askVoice({ voice: 'claude', voiceCommand: '/cli/claude', emptyCwd: '/empty' }, state, c.runner);
  assert.equal(action.speak, 'hello');
  const [command, args, options] = c.calls[0];
  assert.equal(command, '/cli/claude');
  assert.ok(args.includes('--bare'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--system-prompt') + 1], VOICE_INSTRUCTIONS);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(options.cwd, '/empty');
  assert.match(options.input, /You are here with a small group/);
  assert.doesNotMatch(args.join(' '), /hello/);
});

test('Codex runs read-only with its built-in instructions replaced', async () => {
  const c = capture('{"memory":"kept"}');
  const action = await askVoice({ voice: 'codex', voiceCommand: '/cli/codex', emptyCwd: '/empty', instructionsFile: 'C:\\room\\codex-instructions.txt' }, state, c.runner);
  assert.equal(action.memory, 'kept');
  const [, args, options] = c.calls[0];
  assert.deepEqual(args, ['-c', "model_instructions_file='C:/room/codex-instructions.txt'", 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
  assert.match(options.input, /"incoming"/);
});

test('OpenCode runs pure with a generated agent that denies every tool', async () => {
  const c = capture('{"wake_in_minutes":30}');
  const action = await askVoice({ voice: 'opencode', voiceCommand: '/cli/opencode', emptyCwd: '/empty' }, state, c.runner);
  assert.equal(action.wake_in_minutes, 30);
  const [, args, options] = c.calls[0];
  assert.deepEqual(args, ['--pure', 'run', '--agent', 'once']);
  const config = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.agent.once.prompt, VOICE_INSTRUCTIONS);
  assert.equal(config.agent.once.permission.bash, 'deny');
  assert.equal(config.agent.once.permission.read, 'deny');
  assert.equal(options.env.OPENCODE_DISABLE_CLAUDE_CODE, 'true');
  assert.match(options.input, /wake_in_minutes/);
});

test('askVoice rejects non-action output from the local CLI', async () => {
  const c = capture('I would like to say hello.');
  await assert.rejects(() => askVoice({ voice: 'codex', voiceCommand: 'codex', emptyCwd: '/empty', instructionsFile: '/room/codex-instructions.txt' }, state, c.runner), /did not return an action/);
});
