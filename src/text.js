// Yoda Mail — the text pipeline.
//
// Pure functions only: raw email text in, speakable Yoda chunks out. Nothing in
// here touches the DOM, chrome.* or speechSynthesis, which is what makes it
// testable from Node (see test/text.test.js).
//
//   raw email
//     -> cleanBody()   drop quoted replies, footers, URLs, layout junk
//     -> summarise()   score paragraphs, keep the informative ones, hard cap
//     -> yodaify()     de-corporate the wording, invert the grammar
//     -> chunk()       split into utterances short enough for Chrome to finish

const YodaText = (function () {
  // Chrome's speech synthesis gets unreliable on long utterances, and nobody
  // wants a five-minute email read aloud. These caps keep a read to ~40s.
  const MAX_SPEECH_CHARS = 700;
  const MAX_SENTENCES = 6;
  const MAX_CHUNK_CHARS = 180;

  // ─── Cleaning ───────────────────────────────────────────────────────────────

  // The header Gmail (and every other client) puts above a quoted reply.
  const QUOTE_HEADER_RE =
    /^\s*(on\s.{5,160}\bwrote:\s*$|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,}|_{5,}\s*$|from:\s+\S.*$|sent:\s+\S.*$)/i;

  // Marketing / legal tails that carry no information but score well otherwise.
  const FOOTER_RE =
    /^\s*(unsubscribe\b|manage\s+(your\s+)?(email\s+)?preferences\b|update\s+your\s+preferences\b|view\s+(this\s+)?(email\s+)?in\s+(your\s+)?browser\b|sent\s+from\s+my\s+\w+|this\s+(e-?mail|message)\b.{0,60}\b(confidential|intended\s+(solely\s+)?(recipient|for))|confidentiality\s+notice\b|disclaimer:|privacy\s+policy\b|terms\s+of\s+(service|use)\b|all\s+rights\s+reserved\b|©|\(c\)\s*\d{4}|copyright\s+\d{4}|you\s+(are\s+)?receiv(ed|ing)\s+this\b|to\s+stop\s+receiving\b|add\s+us\s+to\s+your\s+address\s+book\b)/i;

  // Lines that are pure layout: separators, image placeholders, bare URLs.
  // Must never match a blank line — paragraph breaks are what the summariser
  // splits on, and eating them merges the whole email into one paragraph.
  const JUNK_LINE_RE =
    /^\s*(\[image:[^\]]*\]|[-=_*~·—]{3,}|https?:\/\/\S+|\|[\s|]*\||[.·|•—-][\s.·|•—-]+)\s*$/i;

  function cutAtQuotedReply(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const isQuote = /^\s*>+/.test(lines[i]) || QUOTE_HEADER_RE.test(lines[i]);
      if (!isQuote) continue;
      // Only cut if there is a real email in front of the quote — otherwise this
      // IS the email (e.g. you opened a forward) and we would be left with nothing.
      const kept = lines.slice(0, i).join('\n');
      if (kept.replace(/\s+/g, ' ').trim().length > 40) return kept;
    }
    return text;
  }

  function cutAtFooter(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!FOOTER_RE.test(lines[i])) continue;
      const kept = lines.slice(0, i).join('\n');
      if (kept.replace(/\s+/g, ' ').trim().length > 40) return kept;
    }
    return text;
  }

  function cleanBody(raw) {
    if (!raw) return '';
    let text = String(raw)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // zero-width + soft hyphen
      .replace(/\u00A0/g, ' '); // non-breaking space

    text = cutAtQuotedReply(text);
    text = cutAtFooter(text);

    text = text
      .split('\n')
      .filter(line => line.trim() === '' || !JUNK_LINE_RE.test(line))
      .join('\n')
      // URLs and raw addresses are unlistenable — drop them, keep the sentence.
      .replace(/<https?:\/\/[^>]+>/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\bwww\.\S+/g, '')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '')
      // Tidy what the deletions left behind.
      .replace(/\(\s*\)|\[\s*\]|<\s*>/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  // ─── Summarising ────────────────────────────────────────────────────────────

  // "by" alone matched every passive sentence and every legal footer, so it now
  // has to be followed by something that looks like a deadline.
  const ACTION_RE =
    /\b(please|must|need\s+to|needs\s+to|required|deadline|due\b|confirm|review|approve|sign\s+off|schedule|reschedule|meet(ing)?\b|call\b|action\s+item|urgent|asap|decision|decide|next\s+steps?|follow[\s-]?up|let\s+me\s+know|respond|reply|by\s+(the\s+)?(eod|eow|cob|noon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next\s+week|\d))\b/i;

  const DATE_RE =
    /\b(\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|next\s+week|this\s+week|\d{1,2}\s*(am|pm)|\d{1,2}:\d{2})\b/i;

  const GREETING_RE =
    /^(hi\b|hello\b|dear\b|hey\b|good\s+(morning|afternoon|evening)\b|hope\s|greetings\b|thanks\b|thank\s+you\b|regards\b|best\b|cheers\b|apolog)/i;

  function paragraphsOf(text) {
    const seen = new Set();
    return text
      .split(/\n{2,}/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(p => {
        if (p.length < 15) return false;
        const key = p.toLowerCase();
        if (seen.has(key)) return false; // the same line twice wastes a slot
        seen.add(key);
        return true;
      });
  }

  function scoreParagraph(p) {
    let score = 0;
    if (GREETING_RE.test(p)) score -= 6;
    if (ACTION_RE.test(p)) score += 3;
    if (DATE_RE.test(p)) score += 2;
    if (/^[-*•]\s|^\d+[.)]\s/.test(p)) score += 1; // bullets carry the substance
    if (p.length > 40 && p.length < 350) score += 1;
    if (p.length > 600) score -= 1;
    return score;
  }

  function summarise(text) {
    const paragraphs = paragraphsOf(text);
    if (!paragraphs.length) return '';

    const keepers = paragraphs.filter(p => scoreParagraph(p) > -3);
    const pool = keepers.length ? keepers : paragraphs;

    // Rank, take the best few, then restore the email's own reading order.
    const ranked = pool
      .map((p, i) => ({ p, i, score: scoreParagraph(p) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 4)
      .sort((a, b) => a.i - b.i)
      .map(x => x.p);

    // Even a "short" email gets capped — the old code read 4000 raw characters.
    let out = [];
    let budget = MAX_SPEECH_CHARS;
    for (const p of ranked) {
      if (budget <= 0) break;
      out.push(p.length > budget ? trimToSentence(p, budget) : p);
      budget -= p.length;
    }
    return out.join('\n\n');
  }

  function trimToSentence(p, budget) {
    const clipped = p.slice(0, Math.max(60, budget));
    const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
    return lastStop > 40 ? clipped.slice(0, lastStop + 1) : clipped.trim() + '.';
  }

  // ─── De-corporate ───────────────────────────────────────────────────────────

  function stripBoilerplate(text) {
    let out = text
      .replace(/^(hi|hello|dear|hey|good\s+(morning|afternoon|evening))\b[^,\n]{0,30}[,.]?\s*/i, '')
      .replace(/\bi\s+hope\s+(you('re|\s+are)\s+)?(well|doing\s+well|all\s+is\s+well)[^.!?\n]*[.!?]?/gi, '')
      .replace(/\bhope\s+(you('re|\s+are)\s+)?(well|doing\s+well|having\s+a\s+\w+\s+\w+)[^.!?\n]*[.!?]?/gi, '')
      .replace(/\bapolog(ies|ise|ize)\s+for\s+(the\s+)?(delay|late\s+reply|inconvenience)[^.!?\n]*[.!?]?/gi, '');

    return cutSignOff(out).trim();
  }

  // The old version cut at the FIRST "thanks" anywhere and threw away the rest of
  // the email. A sign-off only counts if it is a short line near the end.
  function cutSignOff(text) {
    const lines = text.split('\n');
    const SIGNOFF_RE =
      /^\s*(best\s+regards?|kind\s+regards?|warm\s+regards?|regards?|sincerely|cheers|thanks?(\s+(again|so\s+much|a\s+lot))?|thank\s+you(\s+again)?|yours(\s+\w+)?|best|talk\s+soon|speak\s+soon)\s*[,.!]?\s*$/i;

    for (let i = Math.max(1, Math.floor(lines.length * 0.5)); i < lines.length; i++) {
      if (!SIGNOFF_RE.test(lines[i])) continue;
      const kept = lines.slice(0, i).join('\n');
      if (kept.replace(/\s+/g, ' ').trim().length > 40) return kept;
    }
    return text;
  }

  const FILLERS = [
    [/\bi\s+am\s+writing\s+to\s+(inform\s+you\s+that\s+|let\s+you\s+know\s+that\s+)?/gi, ''],
    [/\bi\s+(just\s+)?wanted\s+to\s+(reach\s+out\s+(and\s+)?)?/gi, ''],
    [/\bjust\s+wanted\s+to\s+/gi, ''],
    [/\bplease\s+note\s+that\s+/gi, ''],
    [/\bplease\s+be\s+advised\s+that\s+/gi, ''],
    [/\bas\s+per\s+(our\s+)?(discussion|conversation|call|earlier\s+\w+)\s*,?\s*/gi, ''],
    [/\bfurther\s+to\s+(our\s+)?(discussion|conversation|call)\s*,?\s*/gi, ''],
    [/\bwith\s+reference\s+to\s+/gi, 'about '],
    [/\bi\s+am\s+pleased\s+to\s+(inform|let)\s+you\s+(know\s+)?(that\s+)?/gi, ''],
    [/\bplease\s+(do\s+not\s+hesitate|feel\s+free)\s+to\s+(reach\s+out|contact|ask)[^.!?\n]*[.!?]?/gi, ''],
    [/\bif\s+you\s+have\s+any\s+(questions|queries|concerns)[^.!?\n]*[.!?]?/gi, ''],
    [/\blooking\s+forward\s+to\s+(hearing|your)[^.!?\n]*[.!?]?/gi, ''],
    [/\bat\s+your\s+earliest\s+convenience\b/gi, 'swiftly'],
  ];

  function removeFiller(text) {
    let out = text;
    for (const [pat, rep] of FILLERS) out = out.replace(pat, rep);
    return out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s*[,;:]\s*/gm, '')
      .trim();
  }

  // ─── Yoda grammar ───────────────────────────────────────────────────────────

  function splitSentences(text) {
    return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      // A fragment with no letters ("- 3.") is noise; two letters is a real word.
      .filter(s => /[a-z]{2}/i.test(s));
  }

  const VOCAB = [
    [/\bneed\s+to\b/gi, 'must'],
    [/\bneeds\s+to\b/gi, 'must'],
    [/\bshould\b/gi, 'must'],
    [/\bwould\s+like\s+to\b/gi, 'wish to'],
    [/\blet\s+me\s+know\b/gi, 'inform me'],
    [/\bget\s+back\s+to\b/gi, 'return to'],
    [/\bas\s+soon\s+as\s+possible\b/gi, 'swiftly'],
    [/\bASAP\b/g, 'swiftly'],
    [/\bvery\s+(\w+)/gi, 'most $1'],
    [/\bdefinitely\b/gi, 'certainly'],
  ];

  const INVERSIONS = [
    [/^i\s+will\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, I will.`],
    [/^i\s+have\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, I have.`],
    [/^i\s+am\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, I am.`],
    [/^i\s+(think|believe|hope|suggest)\s+(.+?)[.!?]?$/i, (_, v, r) => `${cap(r)}, ${v} I do.`],
    [/^we\s+(will|must|can|may)\s+(.+?)[.!?]?$/i, (_, v, r) => `${cap(r)}, we ${v}.`],
    [/^you\s+(must|can|will|may)\s+(.+?)[.!?]?$/i, (_, v, r) => `${cap(r)}, you ${v}.`],
    [/^please\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, you must.`],
    [/^this\s+is\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, this is.`],
    [/^it\s+is\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, it is.`],
    [/^there\s+(is|are)\s+(.+?)[.!?]?$/i, (_, v, r) => `${cap(r)}, there ${v}.`],
    [/^the\s+(\w+(?:\s+\w+)?)\s+(is|are|was|were)\s+(.+?)[.!?]?$/i, (_, n, v, r) => `${cap(r)}, the ${n} ${v}.`],
    [/^(?:we|i)\s+(?:are|'re)\s+(.+?)[.!?]?$/i, (_, r) => `${cap(r)}, we are.`],
  ];

  function invertYoda(sentence) {
    let s = sentence;

    // Gratitude only reads as Yoda at the very start or end of a sentence —
    // mid-sentence it produced "the grateful, I am team".
    s = s.replace(/^(thanks|thank\s+you)\b[,!.]?\s*/i, 'Grateful, I am. ');
    s = s.replace(/[,;]?\s*\b(thanks|thank\s+you)\b\s*[.!]?$/i, '. Grateful, I am.');

    for (const [pat, rep] of VOCAB) s = s.replace(pat, rep);
    s = s.replace(/\s{2,}/g, ' ').trim();

    for (const [pat, fn] of INVERSIONS) {
      if (pat.test(s)) {
        const out = s.replace(pat, fn).replace(/\s{2,}/g, ' ').trim();
        // An inversion that ate the sentence is worse than no inversion.
        if (out.length > 6) return cap(out);
      }
    }
    return cap(/[.!?]$/.test(s) ? s : s + '.');
  }

  function cap(str) {
    const s = String(str).trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ─── Chunking ───────────────────────────────────────────────────────────────

  // Long utterances are where Chrome's speech synthesis gives up, so each chunk
  // is kept short and split on punctuation rather than mid-clause.
  function splitLongSentence(s) {
    if (s.length <= MAX_CHUNK_CHARS) return [s];
    const parts = [];
    let current = '';
    for (const piece of s.split(/(?<=[,;:])\s+/)) {
      if ((current + ' ' + piece).trim().length > MAX_CHUNK_CHARS && current) {
        parts.push(current.trim());
        current = piece;
      } else {
        current = (current ? current + ' ' : '') + piece;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.map(p => (/[.!?]$/.test(p) ? p : p.replace(/[,;:]$/, '') + '.'));
  }

  function buildChunks(sentences, opts) {
    const options = opts || {};
    const pick = options.pick || (arr => arr[0]);

    if (!sentences.length) return [{ text: 'Empty, this message is.', type: 'speech' }];

    const chunks = [];
    if (sentences.length > 2) {
      chunks.push({ text: pick(['Hmmmm.', 'Yes, yes.', 'Heh.']), type: 'nonverbal' });
    }

    for (const s of sentences) {
      for (const part of splitLongSentence(s)) chunks.push({ text: part, type: 'speech' });
    }

    if (sentences.length > 3) {
      chunks.push({
        text: pick(['Meditate on this, I will.', 'The Force, guide you it will.', 'Hmm, hmm.']),
        type: 'nonverbal',
      });
    }
    return chunks;
  }

  // ─── Entry point ────────────────────────────────────────────────────────────

  // `subject` is kept separate so it can be spoken as its own line instead of
  // being glued onto the first sentence.
  function yodaify(rawBody, subject, opts) {
    const cleaned = cleanBody(rawBody);
    const summary = summarise(cleaned);
    const text = removeFiller(stripBoilerplate(summary));

    let sentences = splitSentences(text).map(invertYoda).filter(Boolean);
    if (sentences.length > MAX_SENTENCES) sentences = sentences.slice(0, MAX_SENTENCES);

    const chunks = buildChunks(sentences, opts);

    const subj = (subject || '').replace(/\s+/g, ' ').trim();
    if (subj) chunks.unshift({ text: `About "${subj}", this message is.`, type: 'speech' });

    return chunks;
  }

  return {
    yodaify,
    cleanBody,
    summarise,
    stripBoilerplate,
    removeFiller,
    splitSentences,
    invertYoda,
    buildChunks,
    splitLongSentence,
    MAX_SPEECH_CHARS,
    MAX_SENTENCES,
    MAX_CHUNK_CHARS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YodaText;
