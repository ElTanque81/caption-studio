/**
 * Caption Studio — Anna App bundle.
 *
 * Host APIs used (declared in manifest.json → ui.host_api):
 *   anna.llm.complete({ messages, systemPrompt, maxTokens, temperature })
 *   anna.storage.get({ key }) → { value }   /   anna.storage.set({ key, value })
 *   anna.chat.write_message({ role, content })   (not used yet, reserved)
 *   anna.window.set_title({ title })
 *
 * When opened outside Anna (plain browser preview) the SDK import fails and
 * the app runs in "preview" mode: localStorage + canned demo copy.
 */

const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

const PLATFORMS = [
  { id: "shop", name: "Shop listing", color: "var(--shop)", limit: 2000, hashtags: 0,
    guide: "A product description for an online shop (Etsy/Shopify). Open with the benefit, then 3–5 short scannable lines on materials, size, care and why it's special. No hashtags. 80–160 words." },
  { id: "instagram", name: "Instagram", color: "var(--instagram)", limit: 2200, hashtags: 8,
    guide: "An Instagram caption. Strong first line (it is cut off after ~125 characters), short paragraphs, end with the call to action. 40–90 words." },
  { id: "tiktok", name: "TikTok", color: "var(--tiktok)", limit: 4000, hashtags: 5,
    guide: "A TikTok caption. Punchy, conversational, hook in the first 8 words, may use 'POV:' or a question. 15–40 words." },
  { id: "pinterest", name: "Pinterest", color: "var(--pinterest)", limit: 500, hashtags: 4,
    guide: "A Pinterest pin description. Search-friendly: name the product and use cases with natural keywords. 30–60 words." },
  { id: "linkedin", name: "LinkedIn", color: "var(--linkedin)", limit: 3000, hashtags: 3,
    guide: "A LinkedIn post. Professional but human, a small story or insight behind the product, line breaks between thoughts. 60–120 words. Few or no emoji." },
  { id: "x", name: "X", color: "var(--x)", limit: 280, hashtags: 2,
    guide: "A post for X. One or two sentences. The whole text INCLUDING hashtags must stay under 270 characters." },
];

const LANGUAGES = ["English", "Deutsch", "Español", "Français", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "日本語", "한국어", "中文"];

const KEYS = { brands: "caption-studio:brands", activeBrand: "caption-studio:active-brand", history: "caption-studio:history", last: "caption-studio:last-brief", theme: "caption-studio:theme" };

/* Theme: "auto" follows the system, "light"/"dark" are fixed. Anna does not
   pass a theme to apps, so the app keeps its own choice. */
const THEMES = {
  auto:  { label: "Auto",  next: "light", icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>' },
  light: { label: "Light", next: "dark",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  dark:  { label: "Dark",  next: "auto",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>' },
};

function applyTheme(name) {
  const t = THEMES[name] ? name : "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("theme");
  if (btn) {
    btn.innerHTML = `${THEMES[t].icon}<span>${THEMES[t].label}</span>`;
    btn.dataset.theme = t;
    btn.setAttribute("aria-label", `Theme: ${THEMES[t].label}. Click to change.`);
  }
  try { localStorage.setItem(KEYS.theme, t); } catch {}
  return t;
}

// Apply the last choice before anything else renders, to avoid a flash.
try { applyTheme(localStorage.getItem(KEYS.theme) || "auto"); } catch { applyTheme("auto"); }

const DEFAULT_BRAND = { id: "default", name: "My brand", voice: "Friendly, clear and honest", audience: "", avoid: "", emoji: "few" };

const $ = (s) => document.querySelector(s);

const state = {
  anna: null,
  brands: [],
  activeBrandId: "default",
  history: [],
  results: null, // { brief, byPlatform: { [id]: [{ text, hashtags }] } }
  tab: null,
  busy: false,
};

/* ------------------------------------------------------------------ host */

async function connect() {
  try {
    const mod = await import(SDK_URL);
    state.anna = await mod.AnnaAppRuntime.connect();
    $("#conn").classList.add("on");
    $("#conn").title = "Connected to Anna";
    state.anna.window.set_title({ title: "Caption Studio" }).catch(() => {});
  } catch (e) {
    state.anna = null;
    $("#conn").title = "Preview mode (not running inside Anna)";
    console.info("[caption-studio] preview mode:", e?.message || e);
  }
}

async function load(key, fallback) {
  try {
    if (state.anna) {
      const r = await state.anna.storage.get({ key });
      return r && r.value != null ? r.value : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function save(key, value) {
  try {
    if (state.anna) await state.anna.storage.set({ key, value });
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[caption-studio] save failed", key, e);
  }
}

/* ------------------------------------------------------------- prompting */

function brandBlock(b) {
  const emoji = { none: "Do not use emoji.", few: "Use at most 1–2 fitting emoji.", many: "Emoji are welcome where they add energy." }[b.emoji] || "";
  return [
    `Brand: ${b.name}`,
    b.voice && `Voice: ${b.voice}`,
    b.audience && `Audience: ${b.audience}`,
    b.avoid && `Never use these words or phrases: ${b.avoid}`,
    emoji,
  ].filter(Boolean).join("\n");
}

const SYSTEM = `You are a senior e-commerce and social media copywriter.
You write copy that sounds human, specific and true to the product. You never invent facts (prices, materials, awards, discounts) that the user did not give you.
Respond with JSON only, no markdown fences, in exactly this shape:
{"variants":[{"text":"...","hashtags":["word","word"]}]}
Hashtags are lowercase, without the # sign, no spaces. Each variant must take a clearly different angle (e.g. benefit, story, feeling, practical detail).`;

function buildPrompt(brief, platform, brand) {
  return `${brandBlock(brand)}

Platform: ${platform.name}
Format: ${platform.guide}
Hard limit: ${platform.limit} characters per text.
Hashtags per variant: ${platform.hashtags === 0 ? "none (empty array)" : `${Math.max(2, platform.hashtags - 3)}–${platform.hashtags}`}
Language: write everything in ${brief.language}.

Product: ${brief.product}
Details: ${brief.details || "(none given — stay general and do not invent specifics)"}
Call to action: ${brief.cta || "(choose a natural one for the platform, without inventing offers)"}

Write ${brief.count} variants.`;
}

function parseVariants(raw) {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return any copy. Try again.");
  const data = JSON.parse(text.slice(start, end + 1));
  const list = Array.isArray(data.variants) ? data.variants : [];
  const clean = list
    .map((v) => ({
      text: String(v.text || "").trim(),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : [])
        .map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "").trim())
        .filter(Boolean),
    }))
    .filter((v) => v.text);
  if (!clean.length) throw new Error("The model returned an empty answer. Try again.");
  return clean;
}

function completionText(res) {
  const c = res && res.content;
  if (!c) return "";
  if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => b.text).join("");
  return c.text || "";
}

async function ask(userPrompt, maxTokens = 1400) {
  if (!state.anna) return demoAnswer(userPrompt);
  const res = await state.anna.llm.complete({
    systemPrompt: SYSTEM,
    messages: [{ role: "user", content: { type: "text", text: userPrompt } }],
    maxTokens,
    temperature: 0.8,
  });
  return completionText(res);
}

/* Canned output so the UI can be previewed in a normal browser. */
function demoAnswer(prompt) {
  const product = (prompt.match(/Product: (.*)/) || [])[1] || "your product";
  const one = /Write 1 variants/.test(prompt) || /Rewrite/.test(prompt);
  const base = [
    { text: `Meet ${product}. Made with care, built for every day — the kind of thing you reach for first.\n\nTap the link to see it up close.`, hashtags: ["handmade", "shopsmall", "madewithlove", "giftideas"] },
    { text: `Small details, big difference. ${product} is the upgrade your routine has been waiting for. ✨`, hashtags: ["everydayessentials", "smallbusiness", "newin"] },
    { text: `POV: you finally found ${product} that feels like it was made for you. Comment "LINK" and we'll send it over.`, hashtags: ["tiktokmademebuyit", "shoplocal"] },
    { text: `Why we made ${product}: because good things should last. Simple materials, honest work, ready to ship.`, hashtags: ["slowliving", "qualityoverquantity"] },
    { text: `${product} — designed to be used, loved and used again.`, hashtags: ["design", "makers"] },
  ];
  return new Promise((r) => setTimeout(() => r(JSON.stringify({ variants: one ? [base[1]] : base })), 700));
}

/* ---------------------------------------------------------------- brands */

function activeBrand() {
  return state.brands.find((b) => b.id === state.activeBrandId) || state.brands[0] || DEFAULT_BRAND;
}

function renderBrands() {
  const sel = $("#brand");
  sel.innerHTML = "";
  for (const b of state.brands) sel.add(new Option(b.name, b.id, false, b.id === state.activeBrandId));
  sel.add(new Option("+ New brand voice…", "__new"));
}

function openBrandDialog(brand) {
  const isNew = !brand;
  const b = brand || { ...DEFAULT_BRAND, id: "", name: "" };
  $("#b-name").value = b.name;
  $("#b-voice").value = b.voice;
  $("#b-audience").value = b.audience;
  $("#b-avoid").value = b.avoid;
  $("#b-emoji").value = b.emoji;
  $("#brand-dialog").dataset.editing = isNew ? "" : b.id;
  $("#b-delete").hidden = isNew || state.brands.length < 2;
  $("#b-new").hidden = isNew;
  $("#brand-dialog").showModal();
  $("#b-name").focus();
}

function readBrandForm(id) {
  return {
    id,
    name: $("#b-name").value.trim() || "My brand",
    voice: $("#b-voice").value.trim(),
    audience: $("#b-audience").value.trim(),
    avoid: $("#b-avoid").value.trim(),
    emoji: $("#b-emoji").value,
  };
}

async function commitBrand(asNew) {
  const editing = $("#brand-dialog").dataset.editing;
  if (!asNew && editing) {
    const b = readBrandForm(editing);
    state.brands = state.brands.map((x) => (x.id === editing ? b : x));
    state.activeBrandId = editing;
  } else {
    const b = readBrandForm("b" + Date.now().toString(36));
    state.brands.push(b);
    state.activeBrandId = b.id;
  }
  await save(KEYS.brands, state.brands);
  await save(KEYS.activeBrand, state.activeBrandId);
  renderBrands();
  $("#brand-dialog").close();
  toast("Brand voice saved");
}

/* ------------------------------------------------------------------ form */

function renderForm() {
  const box = $("#platforms");
  for (const p of PLATFORMS) {
    const l = document.createElement("label");
    l.className = "chip";
    l.style.setProperty("--c", p.color);
    l.innerHTML = `<input type="checkbox" value="${p.id}"><span class="dot"></span>${p.name}`;
    box.append(l);
  }
  const lang = $("#language");
  for (const l of LANGUAGES) lang.add(new Option(l, l));
  const guess = { de: "Deutsch", es: "Español", fr: "Français", it: "Italiano", pt: "Português", nl: "Nederlands", pl: "Polski", tr: "Türkçe", ja: "日本語", ko: "한국어", zh: "中文" }[(navigator.language || "en").slice(0, 2)];
  lang.value = guess || "English";
}

function readBrief() {
  return {
    product: $("#product").value.trim(),
    details: $("#details").value.trim(),
    cta: $("#cta").value.trim(),
    language: $("#language").value,
    count: Number($("#count").value),
    platforms: [...document.querySelectorAll("#platforms input:checked")].map((i) => i.value),
  };
}

function applyBrief(b) {
  if (!b) return;
  $("#product").value = b.product || "";
  $("#details").value = b.details || "";
  $("#cta").value = b.cta || "";
  if (b.language) $("#language").value = b.language;
  if (b.count) $("#count").value = String(b.count);
  for (const i of document.querySelectorAll("#platforms input")) i.checked = (b.platforms || []).includes(i.value);
}

function setStatus(msg, isError = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}

/* -------------------------------------------------------------- generate */

async function generate(e) {
  e.preventDefault();
  if (state.busy) return;
  const brief = readBrief();
  if (!brief.product) return setStatus("Name the product first.", true);
  if (!brief.platforms.length) return setStatus("Pick at least one place to post.", true);

  state.busy = true;
  $("#go").disabled = true;
  const brand = activeBrand();
  const byPlatform = {};
  const errors = [];
  let done = 0;
  setStatus(`Writing for ${brief.platforms.length} platform${brief.platforms.length > 1 ? "s" : ""}…`);

  // Two requests at a time keeps it quick without hammering the host quota.
  const queue = [...brief.platforms];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const p = PLATFORMS.find((x) => x.id === id);
      try {
        byPlatform[id] = parseVariants(await ask(buildPrompt(brief, p, brand)));
      } catch (err) {
        errors.push(`${p.name}: ${friendlyError(err)}`);
      }
      done++;
      setStatus(`Writing… ${done} of ${brief.platforms.length} done`);
    }
  }
  await Promise.all([worker(), worker()]);

  state.busy = false;
  $("#go").disabled = false;

  const ids = brief.platforms.filter((id) => byPlatform[id]);
  if (!ids.length) {
    setStatus(errors[0] || "Nothing came back. Try again.", true);
    return;
  }
  state.results = { brief, brand: brand.name, byPlatform, at: Date.now() };
  state.tab = ids[0];
  renderResults();
  setStatus(errors.length ? `Done, but ${errors.join(" · ")}` : "Done. Copy what you like or rewrite a variant.", errors.length > 0);

  state.history.unshift(state.results);
  state.history = state.history.slice(0, 12);
  renderHistory();
  save(KEYS.history, state.history);
  save(KEYS.last, brief);
}

function friendlyError(err) {
  const name = err?.name || err?.code || "";
  if (/QUOTA|RATE/i.test(name)) return "usage limit reached, try again in a minute";
  if (/PERMISSION|DENIED|ACL/i.test(name)) return "Anna blocked the request — check the app's permissions";
  if (err instanceof SyntaxError) return "the answer was cut off, try fewer variants";
  return err?.message || "something went wrong";
}

/* --------------------------------------------------------------- results */

function renderResults() {
  const r = state.results;
  const tabs = $("#tabs");
  const box = $("#results");
  tabs.innerHTML = "";
  box.innerHTML = "";
  if (!r) return;

  const ids = r.brief.platforms.filter((id) => r.byPlatform[id]);
  tabs.setAttribute("role", "tablist");
  for (const id of ids) {
    const p = PLATFORMS.find((x) => x.id === id);
    const t = document.createElement("button");
    t.className = "tab";
    t.type = "button";
    t.setAttribute("role", "tab");
    t.setAttribute("aria-selected", String(id === state.tab));
    t.style.setProperty("--c", p.color);
    t.textContent = `${p.name} (${r.byPlatform[id].length})`;
    t.onclick = () => { state.tab = id; renderResults(); };
    tabs.append(t);
  }

  const p = PLATFORMS.find((x) => x.id === state.tab);
  r.byPlatform[state.tab].forEach((v, i) => box.append(renderTag(p, v, i)));
}

function fullText(v) {
  return v.hashtags.length ? `${v.text}\n\n${v.hashtags.map((h) => "#" + h).join(" ")}` : v.text;
}

function renderTag(p, v, index) {
  const el = document.createElement("article");
  el.className = "tag";
  el.style.setProperty("--c", p.color);
  el.style.animationDelay = `${index * 70}ms`;

  const text = document.createElement("p");
  text.className = "tag-text";
  text.textContent = v.text;

  const tags = document.createElement("div");
  tags.className = "tags-line";
  for (const h of v.hashtags) {
    const s = document.createElement("span");
    s.textContent = "#" + h;
    tags.append(s);
  }

  const len = [...fullText(v)].length;
  const pct = Math.min(100, (len / p.limit) * 100);
  const meter = document.createElement("div");
  meter.className = "meter" + (len > p.limit ? " over" : "");
  meter.innerHTML = `<div class="meter-bar"><div class="meter-fill" style="width:${pct}%"></div></div>
    <div class="meter-label">${len} / ${p.limit} characters${len > p.limit ? " — too long for " + p.name : ""}</div>`;

  const actions = document.createElement("div");
  actions.className = "tag-actions";
  actions.append(
    button("Copy", "mini copy", () => copy(fullText(v))),
    button("Shorter", "mini", () => rewrite(el, p, index, "Make it about 40% shorter. Keep the strongest idea.")),
    button("Warmer", "mini", () => rewrite(el, p, index, "Make it warmer and more personal, as if the maker is talking.")),
    button("Stronger CTA", "mini", () => rewrite(el, p, index, "Keep the idea but end with a clearer, more compelling call to action.")),
  );

  el.append(text);
  if (v.hashtags.length) el.append(tags);
  el.append(meter, actions);
  return el;
}

function button(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

async function rewrite(el, p, index, instruction) {
  if (el.classList.contains("busy")) return;
  const r = state.results;
  const v = r.byPlatform[p.id][index];
  const brand = state.brands.find((b) => b.name === r.brand) || activeBrand();
  el.classList.add("busy");
  el.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const prompt = `${brandBlock(brand)}

Platform: ${p.name}
Format: ${p.guide}
Hard limit: ${p.limit} characters.
Language: ${r.brief.language}

Rewrite this ${p.name} text. ${instruction}
Return exactly 1 variant.

Text:
${v.text}

Hashtags: ${v.hashtags.join(", ") || "(none)"}`;
    const [next] = parseVariants(await ask(prompt, 700));
    r.byPlatform[p.id][index] = { text: next.text, hashtags: p.hashtags === 0 ? [] : (next.hashtags.length ? next.hashtags : v.hashtags) };
    save(KEYS.history, state.history);
    const fresh = renderTag(p, r.byPlatform[p.id][index], 0);
    fresh.style.animationDelay = "0ms";
    el.replaceWith(fresh);
  } catch (err) {
    el.classList.remove("busy");
    el.querySelectorAll("button").forEach((b) => (b.disabled = false));
    toast("Rewrite failed: " + friendlyError(err));
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied");
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* --------------------------------------------------------------- history */

function renderHistory() {
  const ul = $("#history");
  ul.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    const names = h.brief.platforms.filter((id) => h.byPlatform[id]).map((id) => PLATFORMS.find((p) => p.id === id).name).join(", ");
    const b = button("", "", () => {
      state.results = h;
      state.tab = h.brief.platforms.find((id) => h.byPlatform[id]);
      applyBrief(h.brief);
      renderResults();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    b.innerHTML = "";
    b.append(document.createTextNode(h.brief.product), document.createElement("br"));
    const small = document.createElement("small");
    small.textContent = names;
    b.append(small);
    li.append(b);
    ul.append(li);
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  renderForm();
  $("#theme").addEventListener("click", () => {
    const next = THEMES[$("#theme").dataset.theme || "auto"].next;
    save(KEYS.theme, applyTheme(next));
  });
  await connect();
  applyTheme(await load(KEYS.theme, $("#theme").dataset.theme || "auto"));

  state.brands = await load(KEYS.brands, [DEFAULT_BRAND]);
  if (!Array.isArray(state.brands) || !state.brands.length) state.brands = [DEFAULT_BRAND];
  state.activeBrandId = await load(KEYS.activeBrand, state.brands[0].id);
  state.history = (await load(KEYS.history, [])) || [];
  renderBrands();
  renderHistory();

  const last = await load(KEYS.last, null);
  if (last) applyBrief(last);
  else document.querySelector('#platforms input[value="instagram"]').checked = true;

  $("#brief").addEventListener("submit", generate);

  $("#brand").addEventListener("change", (e) => {
    if (e.target.value === "__new") {
      e.target.value = state.activeBrandId;
      openBrandDialog(null);
      return;
    }
    state.activeBrandId = e.target.value;
    save(KEYS.activeBrand, state.activeBrandId);
  });
  $("#edit-brand").addEventListener("click", () => openBrandDialog(activeBrand()));
  $("#brand-form").addEventListener("submit", (e) => { e.preventDefault(); commitBrand(false); });
  $("#b-new").addEventListener("click", () => commitBrand(true));
  $("#b-cancel").addEventListener("click", () => $("#brand-dialog").close());
  $("#b-delete").addEventListener("click", async () => {
    const id = $("#brand-dialog").dataset.editing;
    state.brands = state.brands.filter((b) => b.id !== id);
    state.activeBrandId = state.brands[0].id;
    await save(KEYS.brands, state.brands);
    await save(KEYS.activeBrand, state.activeBrandId);
    renderBrands();
    $("#brand-dialog").close();
    toast("Brand voice deleted");
  });

  if (!state.anna) setStatus("Preview mode: showing sample copy. Inside Anna this uses the real AI.");
}

boot();
