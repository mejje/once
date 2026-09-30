import test from 'node:test';
import assert from 'node:assert/strict';
import { Presence } from '../once.mjs';

function harness() {
  const sent = [];
  const reacted = [];
  let n = 0;
  const app = {
    client: {
      chat: {
        postMessage: async args => {
          sent.push(args);
          n += 1;
          return { ts: `900.${n}` };
        },
      },
      reactions: {
        add: async args => {
          reacted.push(args);
          return { ok: true };
        },
      },
    },
  };
  const presence = new Presence({ channel: 'C12345678', botUser: 'UBOT' }, app);
  presence.born = 0;
  presence.alive = true;
  presence.arrange = () => {};
  return { presence, sent, reacted };
}

test('hears a new human message in its channel', () => {
  const { presence } = harness();
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U1', ts: '10.1', event_ts: '10.1', text: 'hello' }, 'E1');
  assert.deepEqual(presence.pending, [{ kind: 'message', id: '10.1', user: 'U1', thread: null, text: 'hello' }]);
  presence.die();
});

test('heard messages point at a thread only when they have one', () => {
  const { presence } = harness();
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U1', ts: '10.1', text: 'plain' }, 'E1');
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U2', ts: '11.1', thread_ts: '11.0', text: 'in thread' }, 'E2');
  assert.equal(presence.references.get('10.1'), null);
  assert.equal(presence.references.get('11.1'), '11.0');
  presence.die();
});

test('ignores other channels, bots and its own messages', () => {
  const { presence } = harness();
  presence.hear({ type: 'message', channel: 'COTHER00', user: 'U1', ts: '10.1', text: 'x' }, 'E1');
  presence.hear({ type: 'message', channel: 'C12345678', user: 'UBOT', ts: '10.2', text: 'x' }, 'E2');
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U2', bot_id: 'B1', ts: '10.3', text: 'x' }, 'E3');
  assert.equal(presence.pending.length, 0);
  presence.die();
});

test('deduplicates Slack events', () => {
  const { presence } = harness();
  const event = { type: 'message', channel: 'C12345678', user: 'U1', ts: '10.1', text: 'hello' };
  presence.hear(event, 'E1');
  presence.hear(event, 'E1');
  assert.equal(presence.pending.length, 1);
  presence.die();
});

test('records a reaction only for a message it has encountered', () => {
  const { presence } = harness();
  presence.hear({ type: 'reaction_added', channel: 'C12345678', user: 'U1', event_ts: '11', reaction: 'eyes', item: { type: 'message', channel: 'C12345678', ts: '10.1' } }, 'ER0');
  assert.equal(presence.pending.length, 0);
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U2', ts: '10.1', text: 'hello' }, 'E1');
  presence.hear({ type: 'reaction_added', channel: 'C12345678', user: 'U1', event_ts: '11', reaction: 'eyes', item: { type: 'message', channel: 'C12345678', ts: '10.1' } }, 'ER1');
  assert.equal(presence.pending.at(-1).kind, 'reaction');
  presence.die();
});

test('apply replaces memory rather than appending history', async () => {
  const { presence } = harness();
  presence.memory = 'old';
  await presence.apply({ memory: 'new' });
  assert.equal(presence.memory, 'new');
  presence.die();
});

test('apply can create and cancel an in-memory activation', async () => {
  const { presence } = harness();
  await presence.apply({ wake_in_minutes: 1 });
  assert.ok(presence.wakeTimer);
  assert.ok(presence.wakeAt);
  await presence.apply({ wake_in_minutes: null });
  assert.equal(presence.wakeTimer, null);
  assert.equal(presence.wakeAt, null);
  presence.die();
});

test('incoming events schedule a turn while an activation is pending', async () => {
  const { presence } = harness();
  presence.arrange = Presence.prototype.arrange;
  await presence.apply({ wake_in_minutes: 60 });
  presence.hear({ type: 'message', channel: 'C12345678', user: 'U1', ts: '10.1', text: 'hello' }, 'E1');
  assert.ok(presence.turnTimer);
  clearTimeout(presence.turnTimer);
  presence.die();
});

test('the name is ignored before ten messages have been sent', async () => {
  const { presence } = harness();
  await presence.apply({ name: 'Ash' });
  assert.equal(presence.name, '');
  presence.die();
});

test('apply sets the displayed name only once', async () => {
  const { presence } = harness();
  presence.messagesSent = 10;
  await presence.apply({ name: 'Ash' });
  assert.equal(presence.name, 'Ash');
  await presence.apply({ name: 'Rook' });
  assert.equal(presence.name, 'Ash');
  await presence.apply({ name: null });
  assert.equal(presence.name, 'Ash');
  presence.die();
});

test('speech is shown under the chosen name', async () => {
  const { presence, sent } = harness();
  presence.messagesSent = 10;
  await presence.apply({ name: 'Ash', speak: 'hello' });
  assert.equal(sent.at(-1).username, 'Ash');
  await presence.apply({ speak: 'still Ash' });
  assert.equal(sent.at(-1).username, 'Ash');
  presence.die();
});

test('apply speaks in the shared channel', async () => {
  const { presence, sent } = harness();
  await presence.apply({ speak: 'hello <!channel>' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'C12345678');
  assert.equal(sent[0].text, 'hello &lt;!channel&gt;');
  assert.equal(sent[0].parse, 'none');
  assert.equal(presence.messagesSent, 1);
  presence.die();
});

test('apply can reply only to a message it has encountered', async () => {
  const { presence, sent } = harness();
  await assert.rejects(() => presence.apply({ speak: 'x', reply_to: 'missing' }), /Unknown reply target/);
  presence.references.set('10.1', '10.0');
  await presence.apply({ speak: 'reply', reply_to: '10.1' });
  assert.equal(sent[0].thread_ts, '10.0');
  presence.die();
});

test('a reply to a top-level message stays in the channel', async () => {
  const { presence, sent } = harness();
  presence.references.set('10.1', null);
  await presence.apply({ speak: 'top', reply_to: '10.1' });
  assert.equal(sent[0].thread_ts, undefined);
  presence.die();
});

test('apply can react only to a message it has encountered', async () => {
  const { presence, reacted } = harness();
  await assert.rejects(() => presence.apply({ react: { message_id: 'missing', emoji: 'eyes' } }), /Unknown reaction target/);
  presence.references.set('10.1', '10.1');
  await presence.apply({ react: { message_id: '10.1', emoji: 'eyes' } });
  assert.deepEqual(reacted[0], { channel: 'C12345678', timestamp: '10.1', name: 'eyes' });
  presence.die();
});

test('turn consumes current events and applies one action', async () => {
  const { presence, sent } = harness();
  presence.pending.push({ kind: 'message', id: '10.1', user: 'U1', text: 'hello' });
  presence.think = async incoming => {
    assert.equal(incoming.length, 1);
    return { speak: 'heard', memory: 'hello mattered' };
  };
  await presence.turn();
  assert.equal(presence.pending.length, 0);
  assert.equal(presence.memory, 'hello mattered');
  assert.equal(sent[0].text, 'heard');
  presence.die();
});

test('die destroys private in-memory state and intentions', async () => {
  const { presence } = harness();
  presence.memory = 'everything';
  presence.name = 'Ash';
  presence.messagesSent = 10;
  presence.pending.push({ kind: 'message' });
  presence.references.set('1', '1');
  presence.seen.add('E1');
  await presence.apply({ wake_in_minutes: 1 });
  presence.die();
  assert.equal(presence.alive, false);
  assert.equal(presence.memory, '');
  assert.equal(presence.name, '');
  assert.equal(presence.messagesSent, 0);
  assert.deepEqual(presence.pending, []);
  assert.equal(presence.wakeAt, null);
  assert.equal(presence.references.size, 0);
  assert.equal(presence.seen.size, 0);
});
