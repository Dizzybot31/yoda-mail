// Run with:  npm test   (or: node --test)
//
// These lock down the behaviours that were actually broken in v1.0.0: the whole
// email being read aloud, sign-offs eating the body, quoted reply chains and
// unsubscribe footers being spoken, and utterances long enough for Chrome to
// cut off mid-sentence.

const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/text.js');

const spoken = chunks => chunks.map(c => c.text).join(' ');

// A realistic work email: greeting, filler, the actual ask, sign-off, and the
// quoted message the reply was written on top of.
const WORK_EMAIL = `Hi Akash,

I hope you're doing well. I wanted to reach out about the Q3 budget review.

We need to finalise the numbers by Friday. Please confirm the headcount figures
and approve the revised forecast before the board call.

There is one open question on the marketing spend. Let me know if you disagree.

Thanks,
Priya

On Mon, 12 May 2026 at 09:14, Akash Seth <akash@example.com> wrote:
> Sounds good, let's sync next week.
> I'll pull the latest numbers before then.`;

const MARKETING_EMAIL = `Hello there!

Our summer sale is live. Save 40% on everything until Sunday.
Shop now: https://shop.example.com/sale?utm_source=email&utm_campaign=summer

Visit our website at www.example.com or contact support@example.com

Unsubscribe | Manage your preferences | View this email in your browser
© 2026 Example Inc. All rights reserved. This email and any attachments are
confidential and intended solely for the recipient.`;

test('cleanBody drops the quoted reply chain', () => {
  const out = T.cleanBody(WORK_EMAIL);
  assert.ok(!out.includes("let's sync next week"), 'quoted reply survived');
  assert.ok(!out.includes('wrote:'), 'quote header survived');
  assert.ok(out.includes('Q3 budget review'), 'real content was dropped');
});

test('cleanBody strips URLs, bare domains and email addresses', () => {
  const out = T.cleanBody(MARKETING_EMAIL);
  assert.ok(!/https?:\/\//.test(out), 'a URL survived');
  assert.ok(!/www\./.test(out), 'a bare domain survived');
  assert.ok(!/@example\.com/.test(out), 'an email address survived');
});

test('cleanBody cuts marketing and legal footers', () => {
  const out = T.cleanBody(MARKETING_EMAIL).toLowerCase();
  assert.ok(!out.includes('unsubscribe'));
  assert.ok(!out.includes('all rights reserved'));
  assert.ok(!out.includes('intended solely'));
  assert.ok(out.includes('summer sale'), 'the actual offer was dropped');
});

test('cleanBody keeps paragraph breaks', () => {
  // The summariser splits on blank lines. If junk-line filtering eats them, the
  // whole email collapses into one paragraph and nothing can be ranked or cut.
  const out = T.cleanBody(WORK_EMAIL);
  assert.ok(out.includes('\n\n'), 'paragraph breaks were collapsed');
  assert.ok(out.split('\n\n').length >= 3, 'expected several paragraphs');
});

test('the sign-off block is dropped, not spoken', () => {
  const out = T.cleanBody(WORK_EMAIL);
  const spokenText = T.summarise(out);
  assert.ok(!/\bPriya\b/.test(spokenText), 'the sign-off name was read aloud');
});

test('a sign-off does not delete the rest of the email', () => {
  // v1.0.0 cut at the first "thanks" that ended a line and lost everything after.
  const body = `Thanks for sending that over.

We need to finalise the numbers by Friday.

Regards,
Priya`;
  const out = T.stripBoilerplate(T.cleanBody(body));
  assert.ok(out.includes('finalise the numbers'), 'body was eaten by the sign-off cut');
  assert.ok(!/^\s*Regards,?\s*$/m.test(out), 'trailing sign-off survived');
});

test('an email that is only a forward is not emptied', () => {
  const fwd = `---------- Forwarded message ----------
From: Someone <someone@example.com>
Subject: Server maintenance

The database will be offline on Saturday from 02:00 until 06:00.
Please plan your deployments around this window.`;
  const out = T.cleanBody(fwd);
  assert.ok(out.includes('offline on Saturday'), 'forwarded body was thrown away');
});

test('summarise caps how much gets read aloud', () => {
  const long = Array.from(
    { length: 40 },
    (_, i) => `Paragraph ${i} explains a policy detail that nobody needs read aloud in full, at length.`
  ).join('\n\n');
  const out = T.summarise(long);
  assert.ok(out.length <= T.MAX_SPEECH_CHARS + 200, `summary was ${out.length} chars`);
});

test('a short email is still capped rather than read raw', () => {
  const wall = 'This is one enormous paragraph. '.repeat(200);
  const chunks = T.yodaify(wall, '');
  assert.ok(spoken(chunks).length < 1200, 'a wall of text was read verbatim');
});

test('duplicate paragraphs do not consume the summary slots', () => {
  const repeated = 'The office will be closed on Monday.';
  const dupes = ['Please approve the budget by Friday.', repeated, repeated, repeated].join('\n\n');
  const out = T.summarise(dupes);
  assert.strictEqual(out.split(repeated).length - 1, 1, 'a repeated line was kept more than once');
  assert.ok(out.includes('approve the budget'), 'the duplicates evicted the real content');
});

test('every chunk is short enough for Chrome to finish', () => {
  for (const email of [WORK_EMAIL, MARKETING_EMAIL]) {
    for (const chunk of T.yodaify(email, 'Q3 budget review')) {
      assert.ok(
        chunk.text.length <= T.MAX_CHUNK_CHARS + 40,
        `chunk of ${chunk.text.length} chars: ${chunk.text}`
      );
    }
  }
});

test('the subject is spoken as its own opening line', () => {
  const chunks = T.yodaify(WORK_EMAIL, 'Q3 budget review');
  assert.match(chunks[0].text, /^About "Q3 budget review", this message is\.$/);
});

test('the actual ask survives the whole pipeline', () => {
  const out = spoken(T.yodaify(WORK_EMAIL, 'Q3 budget review')).toLowerCase();
  assert.ok(out.includes('friday'), 'the deadline was lost');
  assert.ok(!out.includes('sync next week'), 'quoted text was read aloud');
  assert.ok(!out.includes('hope you'), 'pleasantries were read aloud');
});

test('gratitude is only inverted at a sentence boundary', () => {
  assert.match(T.invertYoda('Thanks for the update.'), /^Grateful, I am\./);
  assert.ok(
    !/grateful/i.test(T.invertYoda('Send this to the thank you page team.')),
    'mid-sentence gratitude was mangled'
  );
});

test('yoda inversions never return an empty or headless sentence', () => {
  const inputs = [
    'I will send the report tomorrow.',
    'Please review the attached deck.',
    'We must decide before the board call.',
    'It is urgent.',
    'There are two open questions.',
    'The deadline is Friday.',
    'You should confirm the numbers.',
  ];
  for (const s of inputs) {
    const out = T.invertYoda(s);
    assert.ok(out.length > 5, `too short: "${s}" -> "${out}"`);
    assert.match(out, /^[A-Z]/, `not capitalised: "${out}"`);
    assert.match(out, /[.!?]$/, `no terminal punctuation: "${out}"`);
  }
});

test('empty and whitespace input produce a graceful line, not a crash', () => {
  for (const empty of ['', '   \n\n  ', null, undefined]) {
    const chunks = T.yodaify(empty, '');
    assert.ok(chunks.length >= 1);
    assert.match(chunks[0].text, /Empty, this message is\./);
  }
});

test('splitLongSentence breaks on punctuation, not mid-word', () => {
  const long = 'We reviewed the forecast, ' + 'and then we discussed the numbers, '.repeat(12) + 'and agreed.';
  const parts = T.splitLongSentence(long);
  assert.ok(parts.length > 1, 'long sentence was not split');
  for (const p of parts) {
    assert.ok(p.length <= T.MAX_CHUNK_CHARS + 40, `part too long: ${p.length}`);
    assert.match(p, /[.!?]$/, `part has no terminal punctuation: "${p}"`);
  }
});

test('the pipeline is fast enough to run on click', () => {
  const big = (WORK_EMAIL + '\n\n').repeat(60);
  const started = process.hrtime.bigint();
  T.yodaify(big, 'Perf check');
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 250, `pipeline took ${ms.toFixed(0)}ms — check for regex backtracking`);
});
