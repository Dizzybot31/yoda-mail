// Regression tests for the "it pinged every time I opened an email" bug.
//
// The watcher only ever sees document.title, so a whole browsing session can be
// replayed here as a list of titles.

const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/watcher.js');

// Replay a sequence of titles and return how many chimes it would fire.
function replay(titles, startBaseline) {
  let baseline = startBaseline === undefined ? null : startBaseline;
  const chimes = [];
  for (const title of titles) {
    const result = W.decide(baseline, W.readUnreadCount(title));
    baseline = result.baseline;
    if (result.chime > 0) chimes.push(result.chime);
  }
  return { chimes, baseline };
}

test('reads the unread count out of every Gmail title shape', () => {
  assert.strictEqual(W.readUnreadCount('(12) Inbox - you@gmail.com - Gmail'), 12);
  assert.strictEqual(W.readUnreadCount('Inbox (7) - you@gmail.com - Gmail'), 7);
  assert.strictEqual(W.readUnreadCount('(1,204) Inbox - you@gmail.com - Gmail'), 1204);
});

test('a mailbox with no count means zero, not unknown', () => {
  assert.strictEqual(W.readUnreadCount('Inbox - you@gmail.com - Gmail'), 0);
  assert.strictEqual(W.readUnreadCount('Promotions - you@gmail.com - Gmail'), 0);
});

test('an open message or a search reports unknown, not zero', () => {
  // This is the whole bug: v1.0.0 scored each of these as 0 unread.
  assert.strictEqual(W.readUnreadCount('Q3 budget review - you@gmail.com - Gmail'), null);
  assert.strictEqual(W.readUnreadCount('Search results - you@gmail.com - Gmail'), null);
  assert.strictEqual(W.readUnreadCount('Gmail'), null);
  assert.strictEqual(W.readUnreadCount(''), null);
});

test('opening and closing an email fires no chime', () => {
  const { chimes } = replay([
    '(3) Inbox - you@gmail.com - Gmail',        // sitting in the inbox
    'Q3 budget review - you@gmail.com - Gmail', // opened a message
    'Q3 budget review - you@gmail.com - Gmail',
    '(3) Inbox - you@gmail.com - Gmail',        // back to the inbox
  ]);
  assert.deepStrictEqual(chimes, [], 'phantom chime on opening an email');
});

test('opening an email while unread drops to zero still fires no chime', () => {
  const { chimes } = replay([
    '(1) Inbox - you@gmail.com - Gmail',
    'The only unread mail - you@gmail.com - Gmail', // reading it
    'Inbox - you@gmail.com - Gmail',                // now genuinely zero unread
  ]);
  assert.deepStrictEqual(chimes, []);
});

test('a real arrival still fires exactly once', () => {
  const { chimes } = replay([
    '(3) Inbox - you@gmail.com - Gmail',
    '(4) Inbox - you@gmail.com - Gmail', // one arrived
    '(4) Inbox - you@gmail.com - Gmail', // repeated sample, no second chime
  ]);
  assert.deepStrictEqual(chimes, [1]);
});

test('an arrival that lands while reading is caught on return', () => {
  const { chimes } = replay([
    '(2) Inbox - you@gmail.com - Gmail',
    'Some thread - you@gmail.com - Gmail', // reading; mail arrives meanwhile
    '(3) Inbox - you@gmail.com - Gmail',
  ]);
  assert.deepStrictEqual(chimes, [1]);
});

test('reading everything then receiving one fires a chime', () => {
  // v1.0.0 could go blind here, because "no count" clobbered the baseline.
  const { chimes } = replay([
    '(2) Inbox - you@gmail.com - Gmail',
    'Inbox - you@gmail.com - Gmail', // read them all: genuine zero
    '(1) Inbox - you@gmail.com - Gmail',
  ]);
  assert.deepStrictEqual(chimes, [1]);
});

test('a burst of arrivals reports the whole burst', () => {
  const { chimes } = replay(['(0) Inbox - Gmail', '(14) Inbox - Gmail']);
  assert.deepStrictEqual(chimes, [14], 'a burst larger than the old MAX_JUMP was dropped');
});

test('the first sample only sets a baseline', () => {
  const { chimes, baseline } = replay(['(89) Inbox - you@gmail.com - Gmail']);
  assert.deepStrictEqual(chimes, [], 'chimed on the very first reading');
  assert.strictEqual(baseline, 89);
});
