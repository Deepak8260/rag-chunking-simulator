/* Chunk Lab — chunking algorithms.
 * Every chunker returns { chunks, extra } where each chunk carries character
 * offsets (start, end) into the original text, so the UI can draw boundaries
 * and overlaps exactly. Everything runs in the browser; no server needed. */
(function (global) {
  "use strict";

  // ---------- helpers ----------
  function trimRange(text, start, end) {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return [start, end];
  }

  function chunk(text, start, end, meta, trim) {
    if (trim !== false) [start, end] = trimRange(text, start, end);
    if (end <= start) return null;
    return { start, end, text: text.slice(start, end), meta: meta || {} };
  }

  function done(list, extra) {
    const chunks = list.filter(Boolean).map((c, i) => Object.assign(c, { id: i }));
    return { chunks, extra: extra || {} };
  }

  // ---------- tokenizer (approximate GPT-style BPE) ----------
  // Pre-tokenises with the same regex shape as OpenAI's cl100k tokenizer, then
  // splits long words into ~5-character sub-word pieces to mimic BPE merges.
  const PRE_TOKEN = /'(?:s|t|re|ve|m|ll|d)| ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

  function tokenize(text) {
    const out = [];
    PRE_TOKEN.lastIndex = 0;
    let m;
    while ((m = PRE_TOKEN.exec(text))) {
      const s = m.index, piece = m[0];
      const letters = piece.trimStart().length;
      if (letters > 7 && /\p{L}/u.test(piece)) {
        const n = Math.ceil(letters / 5), lead = piece.length - letters, step = Math.ceil(letters / n);
        let a = s;
        for (let k = 0; k < n; k++) {
          const b = k === n - 1 ? s + piece.length : s + lead + (k + 1) * step;
          out.push({ start: a, end: b });
          a = b;
        }
      } else {
        out.push({ start: s, end: s + piece.length });
      }
    }
    return out;
  }

  const countTokens = (text) => tokenize(text).length;

  // ---------- unit splitters ----------
  function splitSentences(text) {
    const out = [];
    const re = /([.!?]+["'”’)\]]*)(\s+)|\n[ \t]*\n|\n(?=\s*(?:#|[-*+]\s|\d+[.)]\s|```))/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      // don't split after abbreviations like "e.g. something"
      if (m[1] && /[a-z]/.test(text[re.lastIndex] || "")) continue;
      const end = m[1] ? m.index + m[1].length : m.index;
      const r = trimRange(text, start, end);
      if (r[1] > r[0]) out.push({ start: r[0], end: r[1] });
      start = re.lastIndex;
    }
    const r = trimRange(text, start, text.length);
    if (r[1] > r[0]) out.push({ start: r[0], end: r[1] });
    return out;
  }

  function splitParagraphs(text) {
    const out = [];
    const re = /\n[ \t]*\n\s*/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      const r = trimRange(text, start, m.index);
      if (r[1] > r[0]) out.push({ start: r[0], end: r[1] });
      start = re.lastIndex;
    }
    const r = trimRange(text, start, text.length);
    if (r[1] > r[0]) out.push({ start: r[0], end: r[1] });
    return out;
  }

  // Pack consecutive units into chunks up to maxChars, repeating `overlapUnits` units.
  function groupUnits(text, units, maxChars, overlapUnits, label) {
    const out = [];
    let i = 0;
    while (i < units.length) {
      let j = i;
      while (j < units.length && (j === i || units[j].end - units[i].start <= maxChars)) j++;
      const meta = { [label]: j - i };
      if (units[j - 1].end - units[i].start > maxChars) meta.oversized = true;
      out.push(chunk(text, units[i].start, units[j - 1].end, meta));
      if (j >= units.length) break;
      i = Math.max(i + 1, j - overlapUnits);
    }
    return out;
  }

  // ---------- 1. fixed-size ----------
  function fixed(text, p) {
    const size = Math.max(1, p.size | 0);
    const overlap = Math.min(p.overlap | 0, size - 1);
    const out = [];
    let s = 0;
    while (s < text.length) {
      const e = Math.min(s + size, text.length);
      out.push(chunk(text, s, e, {}, false));
      if (e >= text.length) break;
      s = e - overlap;
    }
    return done(out);
  }

  // ---------- 2. recursive character ----------
  const SEPARATORS = {
    generic: ["\n\n", "\n", ". ", " ", ""],
    markdown: ["\n# ", "\n## ", "\n### ", "\n#### ", "\n```", "\n\n", "\n", ". ", " ", ""],
    python: ["\nclass ", "\ndef ", "\n    def ", "\n\n", "\n", " ", ""],
    javascript: ["\nfunction ", "\nclass ", "\nexport ", "\nconst ", "\nlet ", "\n\n", "\n", " ", ""],
  };

  function splitPieces(text, start, end, seps, size) {
    if (end - start <= size) return [{ start, end }];
    const seg = text.slice(start, end);
    const idx = seps.findIndex((s) => s === "" || seg.includes(s));
    const sep = seps[idx], rest = seps.slice(idx + 1);
    if (sep === "") {
      const out = [];
      for (let s = start; s < end; s += size) out.push({ start: s, end: Math.min(s + size, end) });
      return out;
    }
    // Separators that begin a new block ("\nclass ") stay with the following
    // piece; others (". ") stay with the preceding one.
    const cuts = [];
    let pos = 0;
    while ((pos = seg.indexOf(sep, pos)) !== -1) {
      const cut = sep[0] === "\n" ? pos : pos + sep.length;
      if (cut > 0 && cut < seg.length) cuts.push(cut);
      pos += sep.length;
    }
    const bounds = [0, ...cuts, seg.length];
    const out = [];
    for (let k = 0; k < bounds.length - 1; k++) {
      const ps = start + bounds[k], pe = start + bounds[k + 1];
      if (pe - ps <= size) out.push({ start: ps, end: pe });
      else out.push(...splitPieces(text, ps, pe, rest, size));
    }
    return out;
  }

  // Greedily merge small pieces back up to `size`, carrying `overlap` chars forward.
  function mergePieces(pieces, size, overlap) {
    const ranges = [];
    let cur = [];
    for (const p of pieces) {
      if (cur.length && p.end - cur[0].start > size) {
        ranges.push({ start: cur[0].start, end: cur[cur.length - 1].end });
        while (cur.length && (cur[cur.length - 1].end - cur[0].start > overlap || p.end - cur[0].start > size)) cur.shift();
      }
      cur.push(p);
    }
    if (cur.length) ranges.push({ start: cur[0].start, end: cur[cur.length - 1].end });
    return ranges;
  }

  function recursiveRanges(text, start, end, seps, size, overlap) {
    return mergePieces(splitPieces(text, start, end, seps, size), size, overlap);
  }

  function recursive(text, p) {
    const seps = SEPARATORS[p.preset] || SEPARATORS.generic;
    const size = Math.max(1, p.size | 0);
    const overlap = Math.min(p.overlap | 0, size - 1);
    const ranges = recursiveRanges(text, 0, text.length, seps, size, overlap);
    return done(ranges.map((r) => chunk(text, r.start, r.end, {})));
  }

  // ---------- 3. token-based ----------
  function token(text, p) {
    const toks = tokenize(text);
    const size = Math.max(1, p.size | 0);
    const step = Math.max(1, size - Math.min(p.overlap | 0, size - 1));
    const out = [];
    for (let i = 0; i < toks.length; i += step) {
      const j = Math.min(i + size, toks.length);
      out.push(chunk(text, toks[i].start, toks[j - 1].end, { tokenRange: `${i + 1}–${j}` }));
      if (j >= toks.length) break;
    }
    return done(out);
  }

  // ---------- 4. sentence ----------
  function sentence(text, p) {
    return done(groupUnits(text, splitSentences(text), p.maxChars, p.overlap | 0, "sentences"));
  }

  // ---------- 5. paragraph ----------
  function paragraph(text, p) {
    return done(groupUnits(text, splitParagraphs(text), p.maxChars, 0, "paragraphs"));
  }

  // ---------- 6. sliding window ----------
  function sliding(text, p) {
    const sents = splitSentences(text), n = sents.length;
    const w = Math.max(1, p.window | 0), stride = Math.max(1, p.stride | 0);
    const out = [];
    for (let i = 0; i < n; i += stride) {
      const j = Math.min(i + w, n);
      out.push(chunk(text, sents[i].start, sents[j - 1].end, { sentences: `${i + 1}–${j}` }));
      if (j >= n) break;
    }
    return done(out);
  }

  // ---------- 7. structure-aware (Markdown) ----------
  function parseMarkdownBlocks(text) {
    const lines = [];
    let pos = 0;
    for (const line of text.split("\n")) {
      lines.push({ start: pos, end: pos + line.length, text: line });
      pos += line.length + 1;
    }
    const isBlank = (l) => /^\s*$/.test(l.text);
    const isList = (t) => /^\s*([-*+]|\d+[.)])\s+/.test(t);
    const startsBlock = (t) => /^(#{1,6})\s|^\s*(```|~~~)|^\s*\|/.test(t);
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l.text);
      if (h) {
        blocks.push({ type: "heading", level: h[1].length, title: h[2].replace(/#+\s*$/, "").trim(), start: l.start, end: l.end });
        i++;
        continue;
      }
      if (/^\s*(```|~~~)/.test(l.text)) {
        const fence = l.text.trim().slice(0, 3);
        let j = i + 1;
        while (j < lines.length && !lines[j].text.trim().startsWith(fence)) j++;
        const last = lines[Math.min(j, lines.length - 1)];
        blocks.push({ type: "code", start: l.start, end: last.end });
        i = j + 1;
        continue;
      }
      let j = i + 1, type = "paragraph";
      if (/^\s*\|/.test(l.text)) {
        type = "table";
        while (j < lines.length && /^\s*\|/.test(lines[j].text)) j++;
      } else if (isList(l.text)) {
        type = "list";
        while (j < lines.length && !isBlank(lines[j]) && (isList(lines[j].text) || /^\s+\S/.test(lines[j].text))) j++;
      } else {
        while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines[j].text)) j++;
      }
      blocks.push({ type, start: l.start, end: lines[j - 1].end });
      i = j;
    }
    return blocks;
  }

  function structure(text, p) {
    const max = Math.max(50, p.maxChars | 0);
    const blocks = parseMarkdownBlocks(text);

    // Group blocks into sections; a heading with no body yet (e.g. H1 directly
    // followed by H2) is carried into the next section instead of standing alone.
    const sections = [];
    let path = [], cur = null;
    for (const b of blocks) {
      if (b.type === "heading") {
        path = path.filter((h) => h.level < b.level).concat([{ level: b.level, title: b.title }]);
        if (cur && cur.blocks.some((x) => x.type !== "heading")) { sections.push(cur); cur = null; }
        if (!cur) cur = { blocks: [] };
        cur.blocks.push(b);
        cur.path = path.map((h) => h.title);
      } else {
        if (!cur) cur = { blocks: [], path: path.map((h) => h.title) };
        cur.blocks.push(b);
      }
    }
    if (cur) sections.push(cur);

    const out = [];
    const typesOf = (bs) => [...new Set(bs.map((b) => b.type))];
    for (const sec of sections) {
      const s = sec.blocks[0].start, e = sec.blocks[sec.blocks.length - 1].end;
      if (e - s <= max) {
        out.push(chunk(text, s, e, { path: sec.path, types: typesOf(sec.blocks) }));
        continue;
      }
      // Section too big: pack whole blocks. Code and tables are never split;
      // only oversized prose/list blocks fall back to recursive splitting.
      let group = [];
      const flush = () => {
        if (group.length) out.push(chunk(text, group[0].start, group[group.length - 1].end, { path: sec.path, types: typesOf(group), part: true }));
        group = [];
      };
      for (const b of sec.blocks) {
        if (b.end - b.start > max && (b.type === "paragraph" || b.type === "list")) {
          flush();
          for (const r of recursiveRanges(text, b.start, b.end, SEPARATORS.generic, max, 0)) {
            out.push(chunk(text, r.start, r.end, { path: sec.path, types: [b.type], part: true }));
          }
          continue;
        }
        if (group.length && b.end - group[0].start > max) flush();
        group.push(b);
      }
      flush();
    }

    const chunks = out.filter(Boolean);
    for (const c of chunks) {
      if (c.end - c.start > max) c.meta.oversized = true;
      if (p.prependPath && c.meta.path && c.meta.path.length) {
        c.context = c.meta.path.join(" › ");
        c.embedText = c.context + "\n\n" + c.text;
      }
    }
    return done(chunks);
  }

  // ---------- 8. semantic ----------
  const STOP = new Set(
    ("a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those there " +
      "their they them he she his her we our you your me my not no so than then too very can will just do does did have has had " +
      "into over under about after before also more most such only own same other which who whom what when where why how all any " +
      "both each few some one two may might must would could should while because between through during").split(" ")
  );

  function stem(w) {
    if (w.length <= 4) return w;
    if (w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.endsWith("ing")) return w.slice(0, -3);
    if (w.endsWith("ed")) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }

  function words(t) {
    return (t.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*/gu) || [])
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem);
  }

  function semantic(text, p) {
    const sents = splitSentences(text), n = sents.length;
    if (n < 2) return done([chunk(text, 0, text.length, { sentences: n })], { distances: [], threshold: 0, breaks: [] });

    // Each sentence is embedded together with `buffer` neighbours on each side.
    const buf = p.buffer | 0;
    const docs = sents.map((_, i) => {
      let ws = [];
      for (let k = Math.max(0, i - buf); k <= Math.min(n - 1, i + buf); k++) ws = ws.concat(words(text.slice(sents[k].start, sents[k].end)));
      return ws;
    });
    const df = new Map();
    docs.forEach((ws) => new Set(ws).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
    const vecs = docs.map((ws) => {
      const tf = new Map();
      ws.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
      const v = new Map();
      let norm = 0;
      tf.forEach((c, w) => {
        const x = c * Math.log(1 + n / df.get(w));
        v.set(w, x);
        norm += x * x;
      });
      return { v, norm: Math.sqrt(norm) };
    });
    const cos = (a, b) => {
      if (!a.norm || !b.norm) return 0;
      const [x, y] = a.v.size < b.v.size ? [a, b] : [b, a];
      let s = 0;
      x.v.forEach((val, w) => { const o = y.v.get(w); if (o) s += val * o; });
      return s / (a.norm * b.norm);
    };

    const distances = [];
    for (let i = 0; i < n - 1; i++) distances.push(1 - cos(vecs[i], vecs[i + 1]));
    const sorted = [...distances].sort((a, b) => a - b);
    const threshold = sorted[Math.round((p.percentile / 100) * (sorted.length - 1))];

    const breaks = [];
    const out = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const isBreak = i < n - 1 && distances[i] >= threshold;
      if (isBreak) breaks.push(i);
      if (isBreak || i === n - 1) {
        out.push(chunk(text, sents[s].start, sents[i].end, { sentences: i - s + 1 }));
        s = i + 1;
      }
    }
    return done(out, { distances, threshold, breaks });
  }

  // ---------- retrieval (BM25) ----------
  function bm25(chunks, query, k1 = 1.5, b = 0.75) {
    const q = [...new Set(words(query))];
    if (!q.length || !chunks.length) return [];
    const docs = chunks.map((c) => words(c.embedText || c.text));
    const N = docs.length;
    const avgdl = docs.reduce((a, d) => a + d.length, 0) / N || 1;
    const df = q.map((t) => docs.filter((d) => d.includes(t)).length);
    return docs
      .map((d, i) => {
        let score = 0;
        q.forEach((t, k) => {
          const f = d.filter((w) => w === t).length;
          if (!f) return;
          const idf = Math.log(1 + (N - df[k] + 0.5) / (df[k] + 0.5));
          score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl));
        });
        return { id: chunks[i].id, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  global.Chunkers = { tokenize, countTokens, splitSentences, fixed, recursive, token, sentence, paragraph, sliding, structure, semantic, bm25 };
})(window);
