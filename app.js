/* Chunk Lab — UI wiring. */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const HUES = [212, 28, 150, 276, 46, 338, 186, 96, 252, 8];
  const hue = (i) => HUES[i % HUES.length];
  const tint = (i, a) => `hsl(${hue(i)} 85% var(--chunk-l) / ${a || "var(--chunk-a)"})`;
  const solid = (i) => `hsl(${hue(i)} 65% 46%)`;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString();

  const range = (key, label, min, max, step, value, hint) => ({ type: "range", key, label, min, max, step, value, hint });

  const STRATEGIES = [
    {
      id: "fixed", name: "Fixed-size", sizeKey: "size",
      params: [range("size", "Chunk size (characters)", 50, 2000, 10, 300), range("overlap", "Overlap (characters)", 0, 500, 5, 50)],
      run: Chunkers.fixed,
      info: {
        summary: "Cuts the text every <b>N characters</b>, no matter what is there — mid-word, mid-sentence, mid-table. Optional overlap repeats the tail of each chunk at the start of the next.",
        how: ["Start at character 0.", "Take the next N characters as one chunk.", "Step forward by N − overlap.", "Repeat until the end of the document."],
        pros: ["Trivial to implement and reason about", "Predictable, uniform chunk sizes", "Very fast"],
        cons: ["Splits words and sentences", "Ignores document structure", "Boundaries carry no meaning"],
        best: "Baselines, logs, uniform machine-generated text.",
      },
    },
    {
      id: "recursive", name: "Recursive", sizeKey: "size",
      params: [
        range("size", "Max chunk size (characters)", 50, 2000, 10, 300),
        range("overlap", "Overlap (characters)", 0, 300, 5, 30),
        { type: "select", key: "preset", label: "Separator preset", value: "generic", options: [["generic", "Generic text  (¶ → line → sentence → word)"], ["markdown", "Markdown  (headings → code → ¶ …)"], ["python", "Python  (class → def → ¶ …)"], ["javascript", "JavaScript  (function → class → const …)"]] },
      ],
      run: Chunkers.recursive,
      info: {
        summary: "Tries a <b>prioritised list of separators</b> — paragraphs first, then lines, sentences and words — and only drops to a finer separator when a piece is still too big. Small pieces are then merged back up to the size limit. This is LangChain's <code>RecursiveCharacterTextSplitter</code>; language presets make it a code-aware splitter.",
        how: ["Split on the coarsest separator present (e.g. blank line).", "Any piece still over the limit is split again with the next separator.", "Merge neighbouring pieces greedily until adding one more would exceed the limit.", "Carry trailing pieces (≤ overlap) into the next chunk."],
        pros: ["Keeps paragraphs and sentences together when possible", "Works on almost any text", "Language presets keep functions and classes intact"],
        cons: ["Still size-driven, not meaning-driven", "Separator lists need tuning per format"],
        best: "The go-to default for general text and source code.",
      },
    },
    {
      id: "token", name: "Token-based", sizeKey: "size", unit: "tokens",
      params: [range("size", "Chunk size (tokens)", 8, 512, 4, 64), range("overlap", "Overlap (tokens)", 0, 128, 1, 8)],
      run: Chunkers.token,
      info: {
        summary: "Measures size in <b>tokens</b> — what LLMs and embedding models actually count and bill for — instead of characters. Guarantees each chunk fits the embedding model's input window.",
        how: ["Tokenise the whole document.", "Take N tokens as a chunk.", "Step forward by N − overlap tokens.", "Map token spans back to text."],
        pros: ["Exact control over model limits and cost", "Consistent across languages with different word lengths"],
        cons: ["Tokenizer-specific (tiktoken, SentencePiece …)", "Cuts sentences just like fixed-size"],
        best: "Hard context limits, cost budgeting, multilingual corpora.",
        note: "This demo uses an approximate GPT-style tokenizer (cl100k-shaped pre-tokenisation with sub-word splitting). Real pipelines should use the embedding model's own tokenizer.",
      },
    },
    {
      id: "sentence", name: "Sentence", sizeKey: "maxChars",
      params: [range("maxChars", "Max chunk size (characters)", 80, 2000, 10, 400), range("overlap", "Overlap (sentences)", 0, 3, 1, 1)],
      run: Chunkers.sentence,
      info: {
        summary: "Splits the text into <b>sentences</b>, then packs whole sentences into each chunk until the size budget is reached. A sentence is never cut in half.",
        how: ["Detect sentence boundaries (. ! ? followed by a capital, blank lines, list items).", "Add sentences to the current chunk while it stays under the limit.", "Start a new chunk, optionally repeating the last k sentences."],
        pros: ["Every chunk is grammatical and readable", "Great precision for fact-style questions"],
        cons: ["Sentence detection is imperfect (abbreviations, code)", "Ignores paragraph/section context"],
        best: "Articles, FAQs, transcripts, Q&A datasets.",
      },
    },
    {
      id: "paragraph", name: "Paragraph", sizeKey: "maxChars",
      params: [range("maxChars", "Max chunk size (characters)", 100, 3000, 10, 600, "Small consecutive paragraphs are merged up to this size.")],
      run: Chunkers.paragraph,
      info: {
        summary: "Uses <b>blank lines</b> as boundaries, treating each paragraph as a unit of thought. Short paragraphs are merged together; long ones stay whole.",
        how: ["Split on blank lines.", "Merge consecutive paragraphs while under the size limit.", "Oversized paragraphs become their own chunk."],
        pros: ["Follows the author's own grouping of ideas", "Simple and explainable"],
        cons: ["Paragraph sizes vary wildly", "Useless for text without blank lines"],
        best: "Well-edited prose: essays, reports, blog posts.",
      },
    },
    {
      id: "sliding", name: "Sliding window",
      params: [range("window", "Window size (sentences)", 1, 10, 1, 3), range("stride", "Stride (sentences)", 1, 10, 1, 2, "Stride < window ⇒ neighbouring chunks overlap.")],
      run: Chunkers.sliding,
      info: {
        summary: "Each chunk is a <b>window of W sentences</b> that slides forward by S sentences. When S &lt; W every sentence appears in several chunks, so context is never lost at a boundary.",
        how: ["Split into sentences.", "Chunk i = sentences [i·S, i·S + W).", "Continue until the window reaches the end."],
        pros: ["No idea is stranded at a boundary", "Smooth, highly recallable coverage"],
        cons: ["Redundant storage and embeddings (see Redundancy)", "Near-duplicate results at query time"],
        best: "Dense technical or legal text where facts span sentences.",
      },
    },
    {
      id: "structure", name: "Structure-aware", sizeKey: "maxChars",
      params: [
        range("maxChars", "Max chunk size (characters)", 100, 3000, 10, 800, "Sections larger than this are packed block by block."),
        { type: "check", key: "prependPath", label: "Prepend heading path to each chunk (contextual header)", value: true },
      ],
      run: Chunkers.structure,
      info: {
        summary: "Parses the document's <b>layout</b> — Markdown headings, code blocks, tables, lists — and splits along it. Every chunk knows its heading path (e.g. <code>Handbook › Ingestion › Chunking</code>), which can be prepended so the embedding knows where the text came from.",
        how: ["Parse the document into blocks: heading, paragraph, list, code, table.", "Group blocks into sections by heading.", "Small sections become one chunk; large ones are packed block by block.", "Code and tables are never split; only oversized prose falls back to recursive splitting."],
        pros: ["Chunks align with how humans organised the content", "Code and tables stay intact", "Rich metadata for filtering and citations"],
        cons: ["Needs structured input (Markdown, HTML, PDF layout)", "Section sizes can be uneven"],
        best: "Documentation, wikis, manuals, knowledge bases. Plain text falls back to paragraph packing.",
      },
    },
    {
      id: "semantic", name: "Semantic",
      params: [
        range("percentile", "Breakpoint percentile", 50, 99, 1, 80, "Split where the distance between neighbours is in the top (100 − p)%."),
        range("buffer", "Sentence buffer", 0, 3, 1, 1, "Neighbouring sentences combined with each sentence before comparing."),
      ],
      run: Chunkers.semantic,
      info: {
        summary: "Embeds every sentence (together with its neighbours) and measures how different each sentence is from the next. Where the distance spikes, the <b>topic has shifted</b> — that's where a new chunk starts.",
        how: ["Split into sentences and add a buffer of neighbours to each.", "Embed each buffered sentence.", "Compute cosine distance between consecutive sentences.", "Break wherever the distance is above the chosen percentile."],
        pros: ["Boundaries follow meaning, not formatting", "Each chunk tends to cover one topic"],
        cons: ["Requires an embedding call per sentence (slow, costly)", "Chunk sizes are unpredictable", "Sensitive to the threshold"],
        best: "Long, loosely structured text: transcripts, narratives, mixed-topic notes.",
        note: "This demo uses TF-IDF vectors in the browser as a stand-in for a neural embedding model, so it reacts to shared vocabulary. Try the “Plain prose with topic shifts” sample.",
      },
    },
  ];

  const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
  const state = { text: "", active: "recursive", params: {}, query: "", topK: 3, result: null };
  STRATEGIES.forEach((s) => {
    state.params[s.id] = {};
    s.params.forEach((p) => (state.params[s.id][p.key] = p.value));
  });

  // ---------- running ----------
  function runStrategy(s) {
    const t0 = performance.now();
    const res = s.run(state.text, state.params[s.id]);
    res.ms = performance.now() - t0;
    res.chunks.forEach((c) => {
      c.chars = c.text.length;
      c.tokens = Chunkers.countTokens(c.embedText || c.text);
    });
    return res;
  }

  function statsOf(chunks) {
    const n = chunks.length;
    const chars = chunks.map((c) => c.chars);
    const sum = chars.reduce((a, b) => a + b, 0);
    return {
      n,
      avg: n ? sum / n : 0,
      min: n ? Math.min(...chars) : 0,
      max: n ? Math.max(...chars) : 0,
      avgTok: n ? chunks.reduce((a, c) => a + c.tokens, 0) / n : 0,
      redundancy: state.text.trim().length ? (sum / state.text.trim().length) * 100 : 0,
    };
  }

  // ---------- tabs ----------
  function renderTabs() {
    const items = STRATEGIES.map((s) => [s.id, s.name]).concat([["compare", "⇄ Compare all"]]);
    $("#tabs").innerHTML = items
      .map(([id, name]) => `<button class="tab${id === "compare" ? " compare" : ""}" role="tab" data-id="${id}" aria-selected="${id === state.active}">${name}</button>`)
      .join("");
  }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.active = b.dataset.id;
    renderAll();
  });

  // ---------- controls + info ----------
  function renderControls() {
    const box = $("#controls");
    if (state.active === "compare") {
      box.innerHTML = `<p class="muted small" style="margin:0">Compare mode runs every strategy with its own current parameters. Pick a strategy tab to tune it, then come back here.</p>`;
      return;
    }
    const s = byId[state.active], vals = state.params[s.id];
    box.innerHTML = s.params
      .map((p) => {
        const v = vals[p.key];
        if (p.type === "range")
          return `<div class="ctl"><label for="p-${p.key}">${p.label}<output id="o-${p.key}">${v}</output></label>
            <input type="range" id="p-${p.key}" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" />
            ${p.hint ? `<div class="hint">${p.hint}</div>` : ""}</div>`;
        if (p.type === "select")
          return `<div class="ctl"><label for="p-${p.key}">${p.label}</label><select class="select" id="p-${p.key}" data-key="${p.key}">${p.options
            .map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`)
            .join("")}</select></div>`;
        return `<div class="ctl check"><label><input type="checkbox" data-key="${p.key}"${v ? " checked" : ""} />${p.label}</label></div>`;
      })
      .join("");
  }

  $("#controls").addEventListener("input", (e) => {
    const el = e.target, key = el.dataset.key;
    if (!key) return;
    const vals = state.params[state.active];
    vals[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    const out = document.getElementById("o-" + key);
    if (out) out.textContent = el.value;
    scheduleRun(30);
  });

  function renderInfo() {
    const box = $("#info");
    if (state.active === "compare") {
      box.innerHTML = `<h2>Why compare?</h2><p>The same document can produce 5 chunks or 50 depending on strategy. Look for:</p>
        <ul class="small"><li><b>Count &amp; average size</b> — drives storage, embedding cost and how much context each hit carries.</li>
        <li><b>Size spread</b> (min/max) — wide spreads mean some chunks are noise and some are diluted.</li>
        <li><b>Boundary placement</b> — do boundaries line up with headings and paragraphs, or land at random?</li></ul>`;
      return;
    }
    const s = byId[state.active], i = s.info;
    box.innerHTML = `<h2>${s.name} chunking</h2><p>${i.summary}</p>
      <div class="label">How it works</div><ol class="small">${i.how.map((h) => `<li>${h}</li>`).join("")}</ol>
      <div class="pc"><div><b>Pros</b><ul>${i.pros.map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div><b>Cons</b><ul>${i.cons.map((x) => `<li>${x}</li>`).join("")}</ul></div></div>
      <div class="best"><b>Best for:</b> ${i.best}</div>
      ${i.note ? `<p class="muted small">ⓘ ${i.note}</p>` : ""}`;
  }

  // ---------- single-strategy results ----------
  function renderStats(res) {
    const st = statsOf(res.chunks);
    const cells = [
      [st.n, "chunks"],
      [fmt(st.avg), "avg chars"],
      [fmt(st.avgTok), "avg tokens"],
      [`${st.min}–${st.max}`, "min–max chars"],
      [fmt(st.redundancy) + "%", "redundancy", "Total chunk text ÷ document length. Above 100% means overlap duplicates content."],
      [res.ms < 1 ? "<1 ms" : fmt(res.ms) + " ms", "run time"],
    ];
    $("#stats").innerHTML = cells.map(([v, k, t]) => `<div class="stat"${t ? ` title="${t}"` : ""}><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");

    const s = byId[state.active];
    const useTok = s.unit === "tokens";
    const vals = res.chunks.map((c) => (useTok ? c.tokens : c.chars));
    const target = s.sizeKey ? state.params[s.id][s.sizeKey] : null;
    const top = Math.max(1, ...vals, target || 0);
    $("#sizeLegend").textContent = `${useTok ? "tokens" : "characters"} per chunk${target ? ` · dashed line = limit (${target})` : ""}`;
    $("#sizechart").innerHTML =
      res.chunks.map((c, i) => `<div class="bar" data-c="${c.id}" title="#${c.id + 1}: ${vals[i]} ${useTok ? "tokens" : "chars"}" style="height:${(vals[i] / top) * 100}%;background:${solid(c.id)}"></div>`).join("") +
      (target ? `<div class="target" style="bottom:${(target / top) * 100}%"><span>limit</span></div>` : "");
  }

  function renderSemantic(res) {
    const card = $("#semanticCard");
    const ex = res.extra;
    if (state.active !== "semantic" || !ex.distances || !ex.distances.length) { card.hidden = true; return; }
    card.hidden = false;
    const d = ex.distances, W = 1000, H = 130, pad = 4;
    const bw = W / d.length;
    const y = (v) => H - pad - v * (H - 2 * pad);
    const brk = new Set(ex.breaks);
    const bars = d
      .map((v, i) => `<rect class="b${brk.has(i) ? " brk" : ""}" x="${i * bw + bw * 0.15}" y="${y(v)}" width="${Math.max(1, bw * 0.7)}" height="${H - pad - y(v)}"><title>Between sentence ${i + 1} and ${i + 2}: distance ${v.toFixed(3)}${brk.has(i) ? " → break" : ""}</title></rect>`)
      .join("");
    $("#semChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Distance between consecutive sentences">${bars}<line class="thr" x1="0" x2="${W}" y1="${y(ex.threshold)}" y2="${y(ex.threshold)}" vector-effect="non-scaling-stroke"/></svg>`;
    $("#semLegend").textContent = `threshold ${ex.threshold.toFixed(3)} · ${ex.breaks.length} breakpoints · highlighted bars = new chunk`;
  }

  function renderDoc(res, hitIds) {
    const text = state.text, chunks = res.chunks;
    if (!text.trim()) { $("#doc").innerHTML = `<div class="empty">Paste or load a document to begin.</div>`; return; }
    const pts = new Set([0, text.length]);
    chunks.forEach((c) => { pts.add(c.start); pts.add(c.end); });
    const cuts = [...pts].sort((a, b) => a - b);
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    const startsAt = new Map();
    chunks.forEach((c) => { if (!startsAt.has(c.start)) startsAt.set(c.start, []); startsAt.get(c.start).push(c.id); });

    let active = [], ptr = 0;
    const html = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      while (ptr < sorted.length && sorted[ptr].start <= a) active.push(sorted[ptr++]);
      active = active.filter((c) => c.end > a);
      (startsAt.get(a) || []).forEach((id) => html.push(`<span class="mark" style="--c:${solid(id)}">${id + 1}</span>`));
      const piece = esc(text.slice(a, b));
      if (!active.length) { html.push(`<span class="gap">${piece}</span>`); continue; }
      const ids = active.map((c) => c.id);
      const bg = ids.length === 1
        ? tint(ids[0])
        : `repeating-linear-gradient(135deg, ${ids.map((id, j) => `${tint(id, 0.45)} ${j * 5}px ${(j + 1) * 5}px`).join(", ")})`;
      const hit = ids.some((id) => hitIds.has(id)) ? " hit" : "";
      html.push(`<span class="seg${hit}" data-c="${ids.join(" ")}" style="background:${bg}">${piece}</span>`);
    }
    $("#doc").innerHTML = html.join("");
  }

  function renderChunks(res, hitRank) {
    if (!res.chunks.length) { $("#chunks").innerHTML = `<div class="empty">No chunks.</div>`; return; }
    $("#chunks").innerHTML = res.chunks
      .map((c) => {
        const m = c.meta, badges = [];
        if (hitRank.has(c.id)) badges.push(`<span class="badge hitb">match #${hitRank.get(c.id)}</span>`);
        if (m.types) badges.push(...m.types.map((t) => `<span class="badge">${t}</span>`));
        if (m.sentences !== undefined) badges.push(`<span class="badge">sent ${m.sentences}</span>`);
        if (m.paragraphs !== undefined) badges.push(`<span class="badge">${m.paragraphs} ¶</span>`);
        if (m.tokenRange) badges.push(`<span class="badge">tok ${m.tokenRange}</span>`);
        if (m.oversized) badges.push(`<span class="badge warn" title="Couldn't be split without breaking a unit">over limit</span>`);
        const ctx = c.context ? `<div class="ctx">↳ ${esc(c.context)}</div>` : m.path && m.path.length ? `<div class="ctx muted">${esc(m.path.join(" › "))}</div>` : "";
        return `<div class="chunk${hitRank.has(c.id) ? " is-hit" : ""}" data-c="${c.id}" style="--c:${solid(c.id)}">
          <div class="ch"><b>#${c.id + 1}</b><span class="muted">${c.chars} chars · ${c.tokens} tok</span>${badges.join("")}</div>
          ${ctx}<pre>${esc(c.text)}</pre></div>`;
      })
      .join("");
  }

  function renderHits(res) {
    const box = $("#hits");
    const hits = state.query.trim() ? Chunkers.bm25(res.chunks, state.query).slice(0, state.topK) : [];
    if (!state.query.trim()) box.innerHTML = `<div class="empty">Type a question to see which chunks a keyword retriever would return — then change the strategy and watch the answer context change.</div>`;
    else if (!hits.length) box.innerHTML = `<div class="empty">No chunk shares a keyword with that query.</div>`;
    else
      box.innerHTML = hits
        .map((h, i) => {
          const c = res.chunks[h.id];
          return `<div class="hit" data-c="${c.id}"><span class="rank">#${i + 1}</span><span class="snip">Chunk ${c.id + 1}: ${esc(c.text.replace(/\s+/g, " ").slice(0, 140))}</span><span class="score">${h.score.toFixed(2)}</span></div>`;
        })
        .join("");
    return hits;
  }

  function renderSingle() {
    const res = runStrategy(byId[state.active]);
    state.result = res;
    const hits = renderHits(res);
    const hitIds = new Set(hits.map((h) => h.id));
    const hitRank = new Map(hits.map((h, i) => [h.id, i + 1]));
    renderStats(res);
    renderSemantic(res);
    renderDoc(res, hitIds);
    renderChunks(res, hitRank);
  }

  // ---------- compare ----------
  function renderCompare() {
    const L = Math.max(1, state.text.length);
    const rows = STRATEGIES.map((s) => {
      const res = runStrategy(s), st = statsOf(res.chunks);
      const bars = res.chunks
        .map((c) => `<i title="${s.name} #${c.id + 1}: ${c.chars} chars" style="left:${(c.start / L) * 100}%;width:${Math.max(0.15, ((c.end - c.start) / L) * 100)}%;top:${c.id % 2 ? 50 : 0}%;background:${solid(c.id)}"></i>`)
        .join("");
      return `<span class="name" data-id="${s.id}">${s.name}</span><span class="num">${st.n}</span><span class="num">${fmt(st.avg)}</span><span class="num">${st.min}–${st.max}</span><div class="lane">${bars}</div>`;
    });
    $("#compare").innerHTML = `<div class="cmp"><span class="h">Strategy</span><span class="h num">Chunks</span><span class="h num">Avg</span><span class="h num">Range</span><span class="h lane-h">Boundaries across the document →</span>${rows.join("")}</div>`;
  }

  $("#compare").addEventListener("click", (e) => {
    const n = e.target.closest(".name");
    if (n) { state.active = n.dataset.id; renderAll(); }
  });

  // ---------- orchestration ----------
  function renderResults() {
    const compare = state.active === "compare";
    $("#singleView").hidden = compare;
    $("#compareView").hidden = !compare;
    if (compare) renderCompare();
    else renderSingle();
  }

  function renderAll() {
    renderTabs();
    renderControls();
    renderInfo();
    renderResults();
  }

  let timer = null;
  function scheduleRun(ms) {
    clearTimeout(timer);
    timer = setTimeout(renderResults, ms);
  }

  function setText(t) {
    state.text = t.replace(/\r\n?/g, "\n");
    updateDocMeta();
  }

  function updateDocMeta() {
    const t = state.text;
    const words = (t.match(/\S+/g) || []).length;
    $("#docMeta").textContent = `${t.length.toLocaleString()} characters · ${words.toLocaleString()} words · ~${Chunkers.countTokens(t).toLocaleString()} tokens`;
  }

  // ---------- linking hover between map, cards, bars, hits ----------
  function focusChunk(id, on) {
    document.querySelectorAll(`[data-c~="${id}"]`).forEach((el) => el.classList.toggle("focus", on));
  }
  let focused = null;
  function setFocus(id) {
    if (focused === id) return;
    if (focused !== null) focusChunk(focused, false);
    focused = id;
    if (id !== null) focusChunk(id, true);
  }
  ["#doc", "#chunks", "#sizechart", "#hits"].forEach((sel) => {
    const root = $(sel);
    root.addEventListener("mouseover", (e) => {
      const el = e.target.closest("[data-c]");
      setFocus(el ? el.dataset.c.split(" ")[0] : null);
    });
    root.addEventListener("mouseleave", () => setFocus(null));
  });
  // click a card / bar / hit → scroll the map to that chunk (and vice versa)
  ["#chunks", "#sizechart", "#hits"].forEach((sel) =>
    $(sel).addEventListener("click", (e) => {
      const el = e.target.closest("[data-c]");
      if (!el) return;
      const seg = $(`#doc [data-c~="${el.dataset.c}"]`);
      if (seg) { const doc = $("#doc"); doc.scrollTo({ top: seg.offsetTop - doc.offsetTop - 40, behavior: "smooth" }); }
    })
  );
  $("#doc").addEventListener("click", (e) => {
    const el = e.target.closest("[data-c]");
    if (!el) return;
    const card = $(`#chunks .chunk[data-c="${el.dataset.c.split(" ")[0]}"]`);
    if (card) { const box = $("#chunks"); box.scrollTo({ top: card.offsetTop - box.offsetTop - 8, behavior: "smooth" }); }
  });

  // ---------- inputs ----------
  const sampleSel = $("#sample");
  sampleSel.innerHTML = Object.entries(SAMPLES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("") + `<option value="custom" hidden>Your text</option>`;
  sampleSel.addEventListener("change", () => {
    const s = SAMPLES[sampleSel.value];
    if (!s) return;
    $("#input").value = s.text;
    setText(s.text);
    if (sampleSel.value === "code" && state.params.recursive.preset === "generic") state.params.recursive.preset = "python";
    renderAll();
  });

  $("#input").addEventListener("input", (e) => {
    setText(e.target.value);
    sampleSel.value = "custom";
    scheduleRun(200);
  });

  $("#file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2_000_000) { alert("Please choose a file under 2 MB — this runs in your browser."); return; }
    f.text().then((t) => {
      $("#input").value = t;
      setText(t);
      sampleSel.value = "custom";
      renderAll();
    });
    e.target.value = "";
  });

  $("#query").addEventListener("input", (e) => { state.query = e.target.value; scheduleRun(120); });
  $("#topk").addEventListener("change", (e) => { state.topK = Number(e.target.value); renderResults(); });

  $("#download").addEventListener("click", () => {
    const res = state.result;
    if (!res) return;
    const data = {
      strategy: state.active,
      params: state.params[state.active],
      chunks: res.chunks.map((c) => ({ id: c.id, start: c.start, end: c.end, chars: c.chars, tokens: c.tokens, text: c.embedText || c.text, metadata: c.meta })),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `chunks-${state.active}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("chunklab-theme", root.dataset.theme); } catch (e) {}
  });

  // ---------- boot ----------
  $("#input").value = SAMPLES.markdown.text;
  setText(SAMPLES.markdown.text);
  renderAll();
})();
