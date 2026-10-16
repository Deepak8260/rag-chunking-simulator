/* Chunk Lab — UI wiring: hash router, simulator, compare view. */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  // Curated chunk palette; `on` is the readable text colour on top of each swatch.
  const PALETTE = [
    { c: "#E4572E", on: "#fff" }, { c: "#3A62B0", on: "#fff" }, { c: "#E9A23B", on: "#1B1F23" }, { c: "#1F9E89", on: "#fff" },
    { c: "#D14D72", on: "#fff" }, { c: "#5B8E3E", on: "#fff" }, { c: "#8357A8", on: "#fff" }, { c: "#1683A8", on: "#fff" },
  ];
  const solid = (i) => PALETTE[i % PALETTE.length].c;
  const onColor = (i) => PALETTE[i % PALETTE.length].on;
  const tint = (i, pct) => `color-mix(in srgb, ${solid(i)} ${pct || "var(--tint)"}, transparent)`;
  // Each strategy's signature colour.
  const S_COLORS = { fixed: "#E4572E", recursive: "#E9A23B", token: "#1F9E89", sentence: "#3A62B0", paragraph: "#8357A8", sliding: "#D14D72", structure: "#5B8E3E", semantic: "#1683A8" };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => Math.round(n).toLocaleString();

  const range = (key, label, min, max, step, value) => ({ type: "range", key, label, min, max, step, value });

  // `info` drives the "How it works" tab. Each example is run through the real
  // chunker at render time, so what beginners see is always the true output.
  const STRATEGIES = [
    {
      id: "fixed", name: "Fixed-size",
      short: "Cuts the text every N characters, regardless of words or sentences.",
      params: [range("size", "Chunk size (characters)", 50, 2000, 10, 300), range("overlap", "Overlap (characters)", 0, 500, 5, 50)],
      run: Chunkers.fixed,
      info: {
        idea: "Imagine cutting a long ribbon into pieces that are all exactly 20 cm long. You don't look at what's printed on the ribbon — you just measure and cut. Fixed-size chunking does the same with text: every chunk gets exactly the same number of characters (letters, spaces and punctuation all count).",
        example: { text: "The cat sat on the mat. The dog slept on the rug.", params: { size: 20, overlap: 0 }, caption: "Chunk size = 20 characters. Notice how “mat” is cut into “m” and “at” — the splitter doesn't care where words end." },
        steps: ["Count 20 characters from the start. That's chunk 1.", "Count the next 20 characters. That's chunk 2.", "Keep going until you run out of text. The last chunk is whatever is left."],
        good: ["The easiest strategy to understand and build", "Every chunk is the same size, so cost is predictable"],
        watch: ["Words and sentences get cut in half", "A chunk can start in the middle of one idea and end in another"],
        use: "A simple starting point to compare other strategies against, or text with no structure at all, such as log files.",
      },
    },
    {
      id: "recursive", name: "Recursive",
      short: "Splits on paragraphs, then lines, sentences and words — only going finer when a piece is too big.",
      params: [
        range("size", "Max chunk size (characters)", 50, 2000, 10, 300),
        range("overlap", "Overlap (characters)", 0, 300, 5, 30),
        { type: "select", key: "preset", label: "Separators", value: "generic", options: [["generic", "Generic text"], ["markdown", "Markdown"], ["python", "Python code"], ["javascript", "JavaScript code"]] },
      ],
      run: Chunkers.recursive,
      info: {
        idea: "Think about cutting a layer cake for guests. First you try to separate the layers. If a layer is still too big for a plate, you cut it into slices. Only if a slice is still too big do you cut it smaller. Recursive chunking does the same with text: it first tries to split between paragraphs, then between lines, then sentences, then words — and only makes a smaller cut when it has to.",
        example: { text: "Dogs are loyal. They love walks.\n\nCats are independent. They nap a lot.", params: { size: 40, overlap: 0, preset: "generic" }, caption: "Max size = 40 characters. The whole text is too long, so it first splits at the blank line between the two paragraphs. Each paragraph fits, so it stops there — no sentence is cut." },
        steps: ["Try to split at blank lines (between paragraphs).", "If a piece is still too big, split it at line breaks.", "Still too big? Split where sentences end (“. ”).", "Still too big? Split between words. Only as a last resort does it cut inside a word.", "Finally, glue small neighbouring pieces back together as long as they fit the size limit."],
        good: ["Keeps paragraphs and sentences together whenever possible", "Works well on almost any kind of text", "With a code preset, keeps functions and classes whole"],
        watch: ["It still decides by size, not by meaning", "Different file formats need different break points"],
        use: "The best default for most projects. It's the same idea as LangChain's popular <code>RecursiveCharacterTextSplitter</code>.",
      },
    },
    {
      id: "token", name: "Token-based", unit: "tokens",
      short: "Measures chunk size in tokens — what embedding models actually count.",
      params: [range("size", "Chunk size (tokens)", 8, 512, 4, 64), range("overlap", "Overlap (tokens)", 0, 128, 1, 8)],
      run: Chunkers.token,
      info: {
        idea: "AI models don't read letters or words — they read <b>tokens</b>. A token is a small piece of text: often a short word like “find”, sometimes part of a longer word (“Chunking” → “Chun” + “king”), or a punctuation mark. Every model can only take in a certain number of tokens, and you usually pay per token. Token-based chunking gives every chunk the same number of tokens, so you always know it will fit.",
        example: { text: "Chunking helps chatbots find answers quickly.", params: { size: 4, overlap: 0 }, showTokens: true, caption: "Chunk size = 4 tokens. Long words like “Chunking” count as 2 tokens; short words like “find” count as 1. The full stop is a token on its own." },
        steps: ["Break the whole text into tokens.", "Take the first N tokens as chunk 1.", "Take the next N tokens as chunk 2 (stepping back a little if you set an overlap).", "Repeat until the end."],
        good: ["Guarantees every chunk fits the model's limit", "Makes cost easy to predict"],
        watch: ["Different models split text into tokens differently", "Like fixed-size, it happily cuts sentences in half"],
        use: "When you must stay under a strict model limit or budget.",
        note: "Token counts here are a close approximation of OpenAI-style tokenizers. In a real project, count with your embedding model's own tokenizer.",
      },
    },
    {
      id: "sentence", name: "Sentence",
      short: "Packs whole sentences into each chunk, so no sentence is ever cut in half.",
      params: [range("maxChars", "Max chunk size (characters)", 80, 2000, 10, 400), range("overlap", "Overlap (sentences)", 0, 3, 1, 1)],
      run: Chunkers.sentence,
      info: {
        idea: "Here a sentence is a brick that is never broken. The splitter fills a chunk with whole sentences — like packing books into a box — and when the next sentence won't fit, it closes the box and starts a new one.",
        example: { text: "I love pizza. It is cheesy. Rome is in Italy. It has old ruins.", params: { maxChars: 40, overlap: 0 }, caption: "Max size = 40 characters. The first two sentences fit together (27 characters). Adding “Rome is in Italy.” would go over 40, so it starts chunk 2." },
        steps: ["Find where each sentence ends (at . ! or ?).", "Add sentences to the current chunk one at a time.", "When the next sentence would go over the limit, start a new chunk.", "Optionally repeat the last sentence(s) at the start of the next chunk."],
        good: ["Every chunk reads naturally", "Great for answering specific, factual questions"],
        watch: ["Abbreviations like “Dr.” or “e.g.” can confuse sentence detection", "It doesn't know about headings or sections"],
        use: "Articles, FAQs, news and meeting transcripts.",
      },
    },
    {
      id: "paragraph", name: "Paragraph",
      short: "Uses blank lines as boundaries and merges short paragraphs together.",
      params: [range("maxChars", "Max chunk size (characters)", 100, 3000, 10, 600)],
      run: Chunkers.paragraph,
      info: {
        idea: "Writers already group related ideas into paragraphs, separated by blank lines. This strategy trusts the writer: each paragraph is one unit. Very short paragraphs (like a greeting) are joined with their neighbours, so you don't end up with tiny, useless chunks.",
        example: { text: "Hi Sam,\n\nThanks for the photos!\n\nThe beach looked amazing and the sunset over the water was beautiful.\n\nSee you soon!", params: { maxChars: 60 }, caption: "Max size = 60 characters. “Hi Sam,” and “Thanks for the photos!” are tiny, so they're joined. The long paragraph is too big to join with anything, so it stands alone." },
        steps: ["Split the text wherever there's a blank line.", "Join neighbouring paragraphs together while they still fit the limit.", "A paragraph that is already too long becomes its own chunk — it is never cut."],
        good: ["Follows the author's own grouping of ideas", "Simple and easy to explain"],
        watch: ["Paragraph sizes vary a lot, so chunk sizes do too", "Doesn't work on text without blank lines"],
        use: "Well-written prose: essays, reports, blog posts and emails.",
      },
    },
    {
      id: "sliding", name: "Sliding window",
      short: "Windows of W sentences that slide forward S sentences at a time.",
      params: [range("window", "Window size (sentences)", 1, 10, 1, 3), range("stride", "Stride (sentences)", 1, 10, 1, 2)],
      run: Chunkers.sliding,
      info: {
        idea: "Picture a magnifying glass that shows 3 sentences at a time. You read what's under it, then slide it down by 2 sentences and read again. Because you only moved 2 but can see 3, one sentence appears in both views. That shared sentence is the overlap, and it means no idea is ever lost at the edge of a chunk.",
        example: { text: "One. Two. Three. Four. Five.", params: { window: 3, stride: 2 }, caption: "Window = 3 sentences, stride = 2. “Three.” appears in both chunks — that's the overlap." },
        steps: ["Split the text into sentences.", "Take the first W sentences as chunk 1.", "Move forward by S sentences and take the next W.", "Repeat until the window reaches the end."],
        good: ["No idea is ever stranded at a boundary", "Search is less likely to miss something"],
        watch: ["The same text is stored several times, which costs more", "Search can return near-duplicate chunks"],
        use: "Dense technical or legal text where one fact spans several sentences.",
      },
    },
    {
      id: "structure", name: "Structure-aware",
      short: "Follows the document's headings, lists, code blocks and tables.",
      params: [
        range("maxChars", "Max chunk size (characters)", 100, 3000, 10, 800),
        { type: "check", key: "prependPath", label: "Add heading path to each chunk", value: true },
      ],
      run: Chunkers.structure,
      info: {
        idea: "A well-organised document is like a book with chapters and sections. This strategy reads the headings (like “## Ingredients”) and cuts at section boundaries, so each chunk is one complete section. It also remembers where each chunk came from — for example “Recipe › Ingredients” — and adds that label to the chunk. Now even a chunk that just says “2 eggs” is clearly about a recipe's ingredients.",
        example: { text: "# Recipe\n## Ingredients\n- 2 eggs\n- 1 cup flour\n## Steps\nMix everything. Bake for 20 minutes.", params: { maxChars: 200, prependPath: true }, caption: "Each heading's section becomes one chunk. The heading path (in colour) is added on top so the chunk keeps its context." },
        steps: ["Read the document and recognise headings, paragraphs, lists, code blocks and tables.", "Group everything under a heading into one section.", "If a section fits the size limit, it becomes one chunk.", "If it's too big, split it between blocks — but never cut a code block or table in half.", "Attach the heading path to each chunk."],
        good: ["Chunks match how the content is organised", "Code and tables stay in one piece", "Each chunk knows where it came from"],
        watch: ["Needs structured text (Markdown, HTML). Plain text falls back to paragraphs", "Sections can be very different sizes"],
        use: "Documentation, wikis, manuals and knowledge bases.",
      },
    },
    {
      id: "semantic", name: "Semantic",
      short: "Starts a new chunk wherever the topic shifts between sentences.",
      params: [range("percentile", "Breakpoint percentile", 50, 99, 1, 80), range("buffer", "Sentence buffer", 0, 3, 1, 1)],
      run: Chunkers.semantic,
      info: {
        idea: "This strategy reads like a person: it notices when the topic changes. It compares each sentence with the next one. If they talk about similar things (“Cats purr…” → “Cats sleep…”), they stay together. If the subject suddenly changes (“…Cats sleep a lot.” → “Rockets need fuel.”), that's a topic shift, and a new chunk starts there.",
        example: { text: "Cats purr when happy. Cats sleep a lot. Rockets need fuel. Rockets fly to space.", params: { percentile: 90, buffer: 0 }, caption: "The two sentences about cats are similar, so they stay together. The jump from cats to rockets is a big change, so a new chunk starts there." },
        steps: ["Split the text into sentences.", "Turn each sentence into a list of numbers that captures its meaning (an “embedding”).", "Measure how different each sentence is from the next one.", "Wherever the difference is unusually large, start a new chunk."],
        good: ["Chunk boundaries follow meaning, not formatting", "Each chunk tends to cover one topic"],
        watch: ["Needs an embedding for every sentence, which is slower and costs more", "Chunk sizes are unpredictable", "Results change a lot with the percentile"],
        use: "Long text with loose structure: transcripts, stories, mixed-topic notes. Open the Breakpoints tab to see where it decided to split.",
        note: "To run free in your browser, this demo judges similarity by shared words. Real systems use an embedding model, which also understands synonyms (e.g. “car” ≈ “vehicle”).",
      },
    },
  ];

  // Plain-English help for every setting. Shown in the ⓘ popups and in "How it works".
  // what = what it is; right / left = what happens when you slide it that way.
  const SIZE = { right: "Bigger chunks. Each one holds more information.", left: "Smaller chunks. Each one is short and about just one thing." };
  const PARAM_HELP = {
    fixed: {
      size: { what: "How long each chunk (piece of text) is, counted in letters. Spaces and full stops count as letters too.", ...SIZE },
      overlap: { what: "How many letters from the end of one chunk are copied to the start of the next one. So if a word gets cut at the edge, it still appears whole in one of the chunks.", right: "The chunks share more text, so less gets lost at the edges.", left: "Less copying. At 0, the chunks share nothing." },
    },
    recursive: {
      size: { what: "The longest a chunk (piece of text) is allowed to be, counted in letters. Each chunk is made as big as possible without going over this.", ...SIZE },
      overlap: { what: "About how many letters from the end of one chunk are copied to the start of the next one, so nothing important gets lost at the edges.", right: "The chunks share more text.", left: "Less copying. At 0, the chunks share nothing." },
      preset: { what: "Where the splitter likes to cut. For normal writing, keep “Generic text” — it cuts between paragraphs and sentences. For code, pick Python or JavaScript so it cuts between whole functions instead of through the middle of them." },
    },
    token: {
      size: { what: "How long each chunk (piece of text) is, counted in tokens. A token is a small bit of a word — about 4 letters. So 100 tokens is roughly 75 words.", ...SIZE },
      overlap: { what: "How many tokens from the end of one chunk are copied to the start of the next one.", right: "The chunks share more text.", left: "Less copying. At 0, the chunks share nothing." },
    },
    sentence: {
      maxChars: { what: "The longest a chunk (piece of text) is allowed to be, counted in letters. Whole sentences are added to a chunk until the next sentence won't fit.", right: "More sentences fit into each chunk.", left: "Fewer sentences in each chunk — sometimes just one." },
      overlap: { what: "How many sentences from the end of one chunk are repeated at the start of the next. This helps with words like “it”: the sentence that says what “it” means stays close by.", right: "More sentences are repeated.", left: "Fewer sentences are repeated. At 0, nothing is repeated." },
    },
    paragraph: {
      maxChars: { what: "The longest a chunk (piece of text) is allowed to be, counted in letters. Short paragraphs that sit next to each other are joined together until they reach this size.", right: "More paragraphs are joined into each chunk.", left: "Paragraphs mostly stay on their own." },
    },
    sliding: {
      window: { what: "How many sentences go into each chunk (piece of text).", right: "Longer chunks, with more sentences each.", left: "Shorter chunks, with fewer sentences each." },
      stride: { what: "How many sentences you move forward before starting the next chunk. If you move forward less than the window size, neighbouring chunks share some sentences.", right: "Chunks share fewer sentences. When it equals the window size, they share none.", left: "Chunks share more sentences, so you get more chunks in total." },
    },
    structure: {
      maxChars: { what: "The longest a chunk (piece of text) is allowed to be, counted in letters. A section under a heading that fits becomes one chunk. A longer section is cut into smaller parts.", right: "Whole sections stay together more often.", left: "Big sections are cut into more, smaller parts." },
      prependPath: { what: "Writes the section titles at the top of each chunk, like “Recipe › Ingredients”. Then even a tiny chunk such as “2 eggs” clearly says what it is about — which helps the search find it." },
    },
    semantic: {
      percentile: { what: "How big a change of topic is needed before a new chunk starts. The tool compares each sentence with the next one and scores how different they are.", right: "Only big topic changes start a new chunk, so you get fewer, longer chunks.", left: "Even small topic changes start a new chunk, so you get more, shorter chunks." },
      buffer: { what: "How many nearby sentences are read together when comparing. A few sentences together show the topic better than one sentence alone.", right: "Steadier, smoother cuts.", left: "At 0, each sentence is judged on its own, so the cuts can be jumpy." },
    },
  };

  STRATEGIES.forEach((s) => {
    s.color = S_COLORS[s.id];
    s.params.forEach((p) => (p.help = PARAM_HELP[s.id][p.key]));
  });

  const TABS = [["map", "Chunk map"], ["chunks", "Chunks"], ["retrieval", "Retrieval test"], ["breakpoints", "Breakpoints"], ["how", "How it works"]];

  const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
  const state = { text: "", sample: "markdown", active: "fixed", tab: "map", page: "home", params: {}, query: "", topK: 3, result: null };
  STRATEGIES.forEach((s) => {
    state.params[s.id] = {};
    s.params.forEach((p) => (state.params[s.id][p.key] = p.value));
  });

  // ---------- info tooltips ----------
  const HELP = {
    chunks: { what: "How many chunks (pieces of text) the document was cut into." },
    avgChars: { what: "How long a chunk is on average, counted in letters. Spaces and full stops count as letters too." },
    avgTokens: { what: "How long a chunk is on average, counted in tokens. A token is a small bit of a word that AI reads — about 4 letters." },
    range: { what: "The length of the shortest chunk and the longest chunk, in letters. If these two numbers are far apart, the chunks are very uneven." },
    wordsCut: { what: "How many times a word got chopped in two — like “mat” becoming “m” and “at”. Lower is better. “None” is best." },
    repeated: { what: "How much of the text was saved twice because neighbouring chunks share some words. A little is helpful; a lot is wasteful." },
  };

  // what + "slide right / slide left" lines, used by popups and How it works
  const helpHTML = (h) =>
    `<span class="h-what">${h.what}</span>` +
    (h.right ? `<span class="h-move"><b>Slide right →</b> ${h.right}</span><span class="h-move"><b>← Slide left</b> ${h.left}</span>` : "");

  const INFO_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.75v5.75" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.3" fill="currentColor"/></svg>`;
  const infoBtn = (name, help) =>
    help ? `<button type="button" class="info" aria-label="What is “${esc(name)}”?" data-tip="${esc(helpHTML(help))}" data-title="${esc(name)}">${INFO_ICON}</button>` : "";

  // One shared popup, positioned next to whichever ⓘ is hovered, focused or tapped.
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;

  function showTip(btn) {
    tipFor = btn;
    tip.innerHTML = `<strong>${btn.dataset.title}</strong>${btn.dataset.tip}`;
    tip.hidden = false;
    const r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 12;
    const left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), innerWidth - w - m);
    const above = r.top - h - 10 > m;
    tip.style.left = left + scrollX + "px";
    tip.style.top = (above ? r.top - h - 10 : r.bottom + 10) + scrollY + "px";
    tip.style.setProperty("--arrow", r.left + r.width / 2 - left + "px");
    tip.dataset.side = above ? "top" : "bottom";
  }
  function hideTip() { tip.hidden = true; tipFor = null; }

  document.addEventListener("mouseover", (e) => { const b = e.target.closest(".info"); if (b && b !== tipFor) showTip(b); });
  document.addEventListener("mouseout", (e) => { const b = e.target.closest(".info"); if (b && !b.contains(e.relatedTarget)) hideTip(); });
  document.addEventListener("focusin", (e) => { if (e.target.closest(".info")) showTip(e.target.closest(".info")); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".info")) hideTip(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".info");
    if (b) { e.preventDefault(); showTip(b); } // tap on touch screens; preventDefault stops the label toggling its control
    else if (tipFor) hideTip();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
  addEventListener("scroll", hideTip, { passive: true });

  // ---------- running ----------
  function runStrategy(s) {
    const res = s.run(state.text, state.params[s.id]);
    res.chunks.forEach((c) => {
      c.chars = c.text.length;
      c.tokens = Chunkers.countTokens(c.embedText || c.text);
    });
    return res;
  }

  function statsOf(chunks) {
    const n = chunks.length, chars = chunks.map((c) => c.chars);
    return {
      n,
      avg: n ? chars.reduce((a, b) => a + b, 0) / n : 0,
      min: n ? Math.min(...chars) : 0,
      max: n ? Math.max(...chars) : 0,
      avgTok: n ? chunks.reduce((a, c) => a + c.tokens, 0) / n : 0,
    };
  }

  // A strategy's "fingerprint": every chunk drawn in the strategy's colour at its
  // position in the document, alternating between two lanes so overlaps show.
  function laneHTML(chunks, len, color) {
    return `<div class="lane">${chunks
      .map((c) => `<i title="Chunk ${c.id + 1}: ${c.text.length} chars" style="left:${(c.start / len) * 100}%;width:${Math.max(0.3, ((c.end - c.start) / len) * 100)}%;top:${c.id % 2 ? 50 : 0}%;background:${color};opacity:${c.id % 2 ? 0.55 : 1}"></i>`)
      .join("")}</div>`;
  }

  // ---------- overview ----------
  $("#strategyCards").innerHTML = STRATEGIES.map((s, i) => {
    const text = SAMPLES.markdown.text;
    const lane = laneHTML(s.run(text, state.params[s.id]).chunks, text.length, s.color);
    return `<a class="s-card" href="#/sim/${s.id}" style="--s:${s.color}">
      <div class="top"><span class="num">0${i + 1}</span><span class="dot"></span></div>
      <h3>${s.name}</h3><p>${s.short}</p>${lane}
      <span class="go">Explore <span>→</span></span></a>`;
  }).join("");

  // Hero demo: one short text, re-chunked by each strategy in turn.
  const DEMO_TEXT = "RAG gives a language model an open book. Before it answers, it searches your documents for the passages that matter.\n\nThose passages are chunks. Their size and their edges decide what the model gets to read, and whether the answer is in there at all.";
  const DEMO_PARAMS = {
    fixed: { size: 64, overlap: 0 }, recursive: { size: 90, overlap: 20, preset: "generic" }, token: { size: 14, overlap: 0 },
    sentence: { maxChars: 120, overlap: 0 }, paragraph: { maxChars: 100 }, sliding: { window: 2, stride: 1 },
    structure: { maxChars: 140, prependPath: false }, semantic: { percentile: 60, buffer: 0 },
  };
  let demoIdx = 0, demoTimer = null, demoPaused = false;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  $("#demoSteps").innerHTML = STRATEGIES.map((s, i) => `<button role="tab" data-i="${i}" style="--c:${s.color}" aria-label="${s.name}"></button>`).join("");

  function showDemo(i, animate) {
    demoIdx = i;
    const s = STRATEGIES[i], chunks = s.run(DEMO_TEXT, DEMO_PARAMS[s.id]).chunks;
    const paint = () => {
      $("#heroDemo").style.setProperty("--s", s.color);
      $("#demoName").textContent = s.name;
      $("#demoCount").textContent = `${chunks.length} chunks`;
      $("#demoText").innerHTML = mapHTML(DEMO_TEXT, chunks);
      $$("#demoSteps button").forEach((b, k) => b.setAttribute("aria-selected", k === i));
      $("#demoText").classList.remove("fade");
    };
    if (!animate || reduceMotion) return paint();
    $("#demoText").classList.add("fade");
    setTimeout(paint, 200);
  }
  function startDemo() {
    clearInterval(demoTimer);
    if (reduceMotion) return;
    demoTimer = setInterval(() => { if (!demoPaused && state.page === "home") showDemo((demoIdx + 1) % STRATEGIES.length, true); }, 3200);
  }
  $("#demoSteps").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { showDemo(Number(b.dataset.i), true); startDemo(); }
  });
  $("#heroDemo").addEventListener("mouseenter", () => (demoPaused = true));
  $("#heroDemo").addEventListener("mouseleave", () => (demoPaused = false));

  // ---------- simulator ----------
  function renderSidebar() {
    $("#stratList").innerHTML = STRATEGIES.map((s) => `<a href="#/sim/${s.id}" style="--c:${s.color}" class="${s.id === state.active ? "active" : ""}"><i></i>${s.name}</a>`).join("");
    const s = byId[state.active], n = STRATEGIES.indexOf(s) + 1;
    $("#page-sim").style.setProperty("--s", s.color);
    $("#simKicker").textContent = `Strategy ${n} of ${STRATEGIES.length}`;
    $("#simTitle").textContent = s.name + " chunking";
    $("#simDesc").textContent = s.short;
  }

  // paints the filled part of a range track (WebKit has no native "progress")
  function setFill(el) {
    el.style.setProperty("--fill", ((el.value - el.min) / (el.max - el.min)) * 100 + "%");
  }

  function renderParams() {
    const s = byId[state.active], vals = state.params[s.id];
    $("#params").innerHTML = s.params
      .map((p) => {
        const v = vals[p.key];
        const info = infoBtn(p.label, p.help);
        if (p.type === "range")
          return `<div class="ctl"><label for="p-${p.key}"><span class="lbl">${p.label}${info}</span><output id="o-${p.key}">${v}</output></label>
            <input type="range" id="p-${p.key}" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" /></div>`;
        if (p.type === "select")
          return `<div class="ctl"><label for="p-${p.key}"><span class="lbl">${p.label}${info}</span></label><select class="select" id="p-${p.key}" data-key="${p.key}">${p.options
            .map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`)
            .join("")}</select></div>`;
        return `<div class="ctl check"><label><input type="checkbox" data-key="${p.key}"${v ? " checked" : ""} /><span class="lbl">${p.label}${info}</span></label></div>`;
      })
      .join("");
    $$('#params input[type="range"]').forEach(setFill);
  }

  $("#params").addEventListener("input", (e) => {
    const el = e.target, key = el.dataset.key;
    if (!key) return;
    state.params[state.active][key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    const out = document.getElementById("o-" + key);
    if (out) out.textContent = el.value;
    if (el.type === "range") setFill(el);
    schedule(renderResults, 30);
  });

  function renderTabs() {
    const tabs = TABS.filter(([id]) => id !== "breakpoints" || state.active === "semantic");
    if (!tabs.some(([id]) => id === state.tab)) state.tab = "map";
    $("#tabs").innerHTML = tabs.map(([id, label]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === state.tab}">${label}</button>`).join("");
    $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
  }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.tab = b.dataset.tab;
    renderTabs();
  });

  function renderStats(res) {
    const st = statsOf(res.chunks);
    const tok = byId[state.active].unit === "tokens";
    const chars = [fmt(st.avg), "avg characters", HELP.avgChars], toks = [fmt(st.avgTok), "avg tokens", HELP.avgTokens];
    const cells = [[st.n, "chunks", HELP.chunks], tok ? toks : chars, tok ? chars : toks, [`${st.min}–${st.max}`, "smallest–largest", HELP.range]];
    $("#stats").innerHTML = cells.map(([v, k, h]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}${infoBtn(k, h)}</div></div>`).join("");
  }

  function renderMap(res) {
    $("#docMap").innerHTML = state.text.trim()
      ? mapHTML(state.text, res.chunks)
      : `<div class="empty">The document is empty. Use “Edit text” to add some.</div>`;
  }

  // Colours the text by chunk; text covered by two chunks gets stripes.
  function mapHTML(text, chunks) {
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
      (startsAt.get(a) || []).forEach((id) => html.push(`<span class="mark" style="--c:${solid(id)};--on:${onColor(id)}">${id + 1}</span>`));
      const piece = esc(text.slice(a, b));
      if (!active.length) { html.push(`<span class="gap">${piece}</span>`); continue; }
      const ids = active.map((c) => c.id);
      const bg = ids.length === 1
        ? tint(ids[0])
        : `repeating-linear-gradient(135deg, ${ids.map((id, j) => `${tint(id, "42%")} ${j * 5}px ${(j + 1) * 5}px`).join(", ")})`;
      const title = ids.map((id) => `Chunk ${id + 1} · ${chunks[id].text.length} chars`).join("\n");
      html.push(`<span class="seg" data-c="${ids.join(" ")}" title="${title}" style="background:${bg}">${piece}</span>`);
    }
    return html.join("");
  }

  function chunkCard(c, extra) {
    const ctx = c.context ? `<div class="ctx">${esc(c.context)}</div>` : "";
    return `<div class="chunk" style="--c:${solid(c.id)}"><div class="ch">${extra || ""}<b>Chunk ${c.id + 1}</b><span>${c.chars} chars · ${c.tokens} tokens</span></div>${ctx}<pre>${esc(c.text)}</pre></div>`;
  }

  function renderChunkList(res) {
    $("#chunkCount").textContent = `${res.chunks.length} chunks`;
    $("#chunkList").innerHTML = res.chunks.length ? res.chunks.map((c) => chunkCard(c)).join("") : `<div class="empty">No chunks.</div>`;
  }

  function renderHits(res) {
    const box = $("#hits");
    if (!state.query.trim()) { box.innerHTML = ""; return; }
    const hits = Chunkers.bm25(res.chunks, state.query).slice(0, state.topK);
    box.innerHTML = hits.length
      ? hits.map((h, i) => chunkCard(res.chunks[h.id], `<span class="rank">#${i + 1}</span>`).replace("</span></div>", ` · score ${h.score.toFixed(2)}</span></div>`)).join("")
      : `<div class="empty">No chunk shares a keyword with that question.</div>`;
  }

  function renderBreakpoints(res) {
    const ex = res.extra;
    if (state.active !== "semantic") return;
    if (!ex.distances || !ex.distances.length) { $("#semChart").innerHTML = `<div class="empty">Need at least two sentences.</div>`; $("#semLegend").textContent = ""; return; }
    const d = ex.distances, W = 1000, H = 180, pad = 4, bw = W / d.length;
    const y = (v) => H - pad - v * (H - 2 * pad);
    const brk = new Set(ex.breaks);
    const bars = d
      .map((v, i) => `<rect class="b${brk.has(i) ? " brk" : ""}" x="${i * bw + bw * 0.15}" y="${y(v)}" width="${Math.max(1, bw * 0.7)}" height="${H - pad - y(v)}"><title>Sentence ${i + 1} → ${i + 2}: ${v.toFixed(3)}${brk.has(i) ? " (new chunk)" : ""}</title></rect>`)
      .join("");
    $("#semChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Distance between consecutive sentences">${bars}<line class="thr" x1="0" x2="${W}" y1="${y(ex.threshold)}" y2="${y(ex.threshold)}" vector-effect="non-scaling-stroke"/></svg>`;
    $("#semLegend").textContent = `Each bar is the distance between two neighbouring sentences. Bars above the dashed threshold (${ex.threshold.toFixed(2)}) start a new chunk — ${ex.breaks.length} breakpoints.`;
  }

  function renderExample(s) {
    const ex = s.info.example;
    const chunks = s.run(ex.text, ex.params).chunks;
    const tokens = ex.showTokens
      ? `<div class="ex-label">Split into tokens</div><div class="ex-tokens">${Chunkers.tokenize(ex.text)
          .map((t) => `<span>${esc(ex.text.slice(t.start, t.end)).replace(/ /g, "␣")}</span>`)
          .join("")}</div>`
      : "";
    const out = chunks
      .map((c) => `<div class="ex-chunk" style="--c:${solid(c.id)};background:${tint(c.id)}"><span class="ex-num">Chunk ${c.id + 1}</span>${c.context ? `<span class="ex-ctx">${esc(c.context)}</span>` : ""}<span class="ex-text">${esc(c.text)}</span></div>`)
      .join("");
    return `<div class="example">
      <div class="ex-label">Input text</div><div class="ex-input">${esc(ex.text)}</div>
      ${tokens}
      <div class="ex-label">Result</div><div class="ex-out">${out}</div>
      <p class="ex-caption">${ex.caption}</p></div>`;
  }

  function renderHow() {
    const s = byId[state.active], i = s.info;
    const list = (xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
    $("#howTo").innerHTML = `<div class="how">
      <h3>The idea</h3><p class="lead">${i.idea}</p>
      <h3>Example</h3>${renderExample(s)}
      <h3>Step by step</h3><ol>${i.steps.map((x) => `<li>${x}</li>`).join("")}</ol>
      <h3>The settings</h3><dl class="settings">${s.params.map((p) => `<div><dt>${p.label}</dt><dd>${helpHTML(p.help)}</dd></div>`).join("")}</dl>
      <div class="pc"><div><h3>Good at</h3>${list(i.good)}</div><div><h3>Watch out for</h3>${list(i.watch)}</div></div>
      <h3>Use it for</h3><p>${i.use}</p>
      ${i.note ? `<div class="note">${i.note}</div>` : ""}</div>`;
  }

  function renderResults() {
    if (state.page === "compare") return renderCompare();
    if (state.page !== "sim") return;
    const res = runStrategy(byId[state.active]);
    state.result = res;
    renderStats(res);
    renderMap(res);
    renderChunkList(res);
    renderHits(res);
    renderBreakpoints(res);
  }

  function renderSim() {
    renderSidebar();
    renderParams();
    renderTabs();
    renderHow();
    renderResults();
  }

  // clicking a chunk in the map outlines all of its pieces (useful for overlaps)
  $("#docMap").addEventListener("click", (e) => {
    const el = e.target.closest("[data-c]");
    $$("#docMap .focus").forEach((x) => x.classList.remove("focus"));
    if (!el) return;
    const id = el.dataset.c.split(" ").pop();
    $$(`#docMap [data-c~="${id}"]`).forEach((x) => x.classList.add("focus"));
  });

  // ---------- compare ----------
  // Splits [0, len) at every chunk edge; each piece lists the chunks covering it.
  function coverage(len, chunks) {
    const cuts = [...new Set([0, len, ...chunks.flatMap((c) => [c.start, c.end])])].sort((a, b) => a - b);
    const segs = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      segs.push({ a, b, ids: chunks.filter((c) => c.start <= a && c.end >= b).map((c) => c.id) });
    }
    return segs;
  }

  // Beginner-friendly measures: words sliced at a chunk edge, and text stored twice.
  function cutQuality(text, chunks, segs) {
    const isWord = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
    const splits = new Set();
    chunks.forEach((c) => {
      [c.start, c.end].forEach((p) => { if (p > 0 && p < text.length && isWord(text[p - 1]) && isWord(text[p])) splits.add(p); });
    });
    const repeated = segs.reduce((n, s) => n + (s.b - s.a) * Math.max(0, s.ids.length - 1), 0);
    return { wordsCut: splits.size, repeatedPct: text.length ? (repeated / text.length) * 100 : 0 };
  }

  // One bar = the whole document; each chunk is a numbered block in the strategy colour.
  function layoutHTML(text, chunks, segs, color) {
    const L = Math.max(1, text.length);
    const blocks = segs
      .map((s) => {
        if (!s.ids.length) return "";
        const id = s.ids[s.ids.length - 1];
        const cls = s.ids.length > 1 ? "blk ov" : `blk${id % 2 ? " alt" : ""}`;
        const tip = s.ids.map((i) => `Chunk ${i + 1}: “${chunks[i].text.replace(/\s+/g, " ").slice(0, 60)}…”`).join("\n");
        return `<i class="${cls}" title="${esc(tip)}" style="left:${(s.a / L) * 100}%;width:${((s.b - s.a) / L) * 100}%"></i>`;
      })
      .join("");
    // Number each chunk at the start of the part it doesn't share with a neighbour.
    const labels = chunks
      .map((c, k) => {
        const from = Math.max(c.start, k > 0 ? chunks[k - 1].end : 0);
        const to = Math.min(c.end, k < chunks.length - 1 ? chunks[k + 1].start : c.end);
        return (to - from) / L > 0.03 ? `<b style="left:${(from / L) * 100}%">${c.id + 1}</b>` : "";
      })
      .join("");
    return `<div class="layout">${blocks}${labels}</div>`;
  }

  function renderCompare() {
    const text = state.text;
    const data = STRATEGIES.map((s) => {
      const res = runStrategy(s), segs = coverage(text.length, res.chunks);
      return { s, res, st: statsOf(res.chunks), q: cutQuality(text, res.chunks, segs), segs };
    });

    // takeaways in plain sentences
    const most = data.reduce((a, b) => (b.st.n > a.st.n ? b : a));
    const fewest = data.reduce((a, b) => (b.st.n < a.st.n ? b : a));
    const cutters = data.filter((d) => d.q.wordsCut > 0).map((d) => d.s.name);
    const repeaters = data.filter((d) => d.q.repeatedPct >= 0.5).map((d) => d.s.name);
    const join = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0]);
    const card = (color, label, body) => `<div class="insight" style="--c:${color}"><div class="i-label">${label}</div><p>${body}</p></div>`;
    $("#insights").innerHTML = [
      card(most.s.color, "Most pieces", `<b>${most.s.name}</b> makes ${most.st.n} chunks — the smallest, most focused pieces.`),
      card(fewest.s.color, "Fewest pieces", `<b>${fewest.s.name}</b> makes only ${fewest.st.n} chunk${fewest.st.n === 1 ? "" : "s"}, about ${fmt(fewest.st.avg)} characters each.`),
      card("#E4572E", "Cuts words in half", cutters.length ? `<b>${join(cutters)}</b> slice${cutters.length === 1 ? "s" : ""} through the middle of words.` : "No strategy cuts a word in half on this document."),
      card("#1683A8", "Repeats text", repeaters.length ? `<b>${join(repeaters)}</b> store${repeaters.length === 1 ? "s" : ""} some text twice (overlap), so ideas aren't lost at the edges.` : "No strategy repeats any text with the current settings."),
    ].join("");

    const rows = data.map(({ s, res, st, q, segs }) => `
      <div class="c-row" style="--c:${s.color}">
        <a class="c-name" href="#/sim/${s.id}"><i></i><span>${s.name}<small>Open in simulator →</small></span></a>
        <div class="c-num"><b>${st.n}</b><small>chunks</small></div>
        <div class="c-num"><b>${fmt(st.avg)}</b><small>avg chars</small></div>
        <div class="c-num ${q.wordsCut ? "bad" : "good"}"><b>${q.wordsCut ? q.wordsCut : "None"}</b><small>words cut</small></div>
        <div class="c-num"><b>${q.repeatedPct >= 0.5 ? fmt(q.repeatedPct) + "%" : "None"}</b><small>repeated</small></div>
        <div class="c-bar">${layoutHTML(text, res.chunks, segs, s.color)}</div>
      </div>`);
    $("#compare").innerHTML = `
      <div class="c-row c-head">
        <span>Strategy</span>
        <span class="c-num">Chunks${infoBtn("Chunks", HELP.chunks)}</span>
        <span class="c-num">Average size${infoBtn("Average size", HELP.avgChars)}</span>
        <span class="c-num">Words cut in half${infoBtn("Words cut in half", HELP.wordsCut)}</span>
        <span class="c-num">Repeated text${infoBtn("Repeated text", HELP.repeated)}</span>
        <span class="c-axis"><span>Start of document</span><span>End</span></span>
      </div>${rows.join("")}`;
  }

  // ---------- document ----------
  const docOptions = Object.entries(SAMPLES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("") + `<option value="custom">Your own text</option>`;
  $$(".doc-select").forEach((sel) => {
    sel.innerHTML = docOptions;
    sel.addEventListener("change", () => {
      if (sel.value === "custom") { openEditor(); syncDocSelects(); return; }
      loadSample(sel.value);
    });
  });

  function syncDocSelects() { $$(".doc-select").forEach((s) => (s.value = state.sample)); }

  function setText(t, sample) {
    state.text = t.replace(/\r\n?/g, "\n");
    state.sample = sample;
    syncDocSelects();
  }

  function loadSample(key) {
    setText(SAMPLES[key].text, key);
    if (key === "code" && state.params.recursive.preset === "generic") state.params.recursive.preset = "python";
    if (state.page === "sim") renderParams();
    renderResults();
  }

  const dialog = $("#docDialog");
  function openEditor() {
    $("#input").value = state.text;
    updateDocMeta();
    dialog.showModal();
  }
  function updateDocMeta() {
    const t = $("#input").value;
    $("#docMeta").textContent = `${t.length.toLocaleString()} characters · ~${Chunkers.countTokens(t).toLocaleString()} tokens`;
  }
  $$(".edit-doc").forEach((b) => b.addEventListener("click", openEditor));
  $("#input").addEventListener("input", () => schedule(updateDocMeta, 150));
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "apply") return;
    const t = $("#input").value;
    if (t === state.text) return;
    setText(t, "custom");
    renderResults();
  });
  $("#file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2_000_000) { alert("Please choose a file under 2 MB — everything runs in your browser."); return; }
    f.text().then((t) => { $("#input").value = t; updateDocMeta(); });
  });

  // ---------- misc controls ----------
  $("#query").addEventListener("input", (e) => { state.query = e.target.value; schedule(() => state.result && renderHits(state.result), 120); });
  $("#topk").addEventListener("change", (e) => { state.topK = Number(e.target.value); state.result && renderHits(state.result); });

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

  const timers = new Map();
  function schedule(fn, ms) {
    clearTimeout(timers.get(fn));
    timers.set(fn, setTimeout(fn, ms));
  }

  // ---------- router ----------
  function route() {
    const [page, id] = location.hash.replace(/^#\/?/, "").split("/");
    state.page = page === "sim" || page === "compare" ? page : "home";
    if (state.page === "sim") state.active = byId[id] ? id : "fixed";
    $$(".page").forEach((p) => (p.hidden = p.id !== "page-" + state.page));
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === state.page));
    $('.nav a[data-route="sim"]').href = `#/sim/${state.active}`;
    if (state.page === "sim") renderSim();
    if (state.page === "compare") renderCompare();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  setText(SAMPLES.markdown.text, "markdown");
  showDemo(0, false);
  startDemo();
  route();
})();
