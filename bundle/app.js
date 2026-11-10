/**
 * Caption Studio — Anna App bundle.
 *
 * Host APIs used (declared in manifest.json → ui.host_api):
 *   anna.llm.complete({ messages, systemPrompt, maxTokens, temperature })
 *     — text prompts, and one text + image message to read a product photo
 *   anna.storage.get({ key }) → { value }   /   anna.storage.set({ key, value })
 *   anna.chat.write_message({ role, content })   (not used yet, reserved)
 *   anna.window.set_title({ title })
 *
 * When opened outside Anna (plain browser preview) the SDK import fails and
 * the app runs in "preview" mode: localStorage + canned demo copy.
 */

import { UI_LANGS, COPY_LANG_FOR_UI, setUiLang, uiLang, detectUiLang, t } from "./i18n.js";

const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

// `name` is what the model sees; the interface shows pName(p).
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

const pName = (p) => (p.id === "shop" ? t("platform.shop") : p.name);

// Languages the copy can be written in (separate from the interface language).
const LANGUAGES = ["English", "Deutsch", "中文", "Русский", "हिन्दी", "Español", "Français", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "日本語", "한국어"];

const KEYS = {
  brands: "caption-studio:brands",
  activeBrand: "caption-studio:active-brand",
  history: "caption-studio:history",
  last: "caption-studio:last-brief",
  theme: "caption-studio:theme",
  uiLang: "caption-studio:ui-lang",
};

/* Theme: "auto" follows the system, "light"/"dark" are fixed. Anna does not
   pass a theme to apps, so the app keeps its own choice. */
const THEMES = {
  auto:  { next: "light", icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>' },
  light: { next: "dark",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  dark:  { next: "auto",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>' },
};

function applyTheme(name) {
  const th = THEMES[name] ? name : "auto";
  if (th === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", th);
  const btn = document.getElementById("theme");
  if (btn) {
    const label = t(`theme.${th}`);
    btn.innerHTML = `${THEMES[th].icon}<span></span>`;
    btn.querySelector("span").textContent = label;
    btn.dataset.theme = th;
    btn.setAttribute("aria-label", t("theme.aria", { name: label }));
    btn.title = label;
  }
  try { localStorage.setItem(KEYS.theme, th); } catch {}
  return th;
}

// Apply the last choices before anything else renders, to avoid a flash.
try { setUiLang(localStorage.getItem(KEYS.uiLang) || detectUiLang()); } catch { setUiLang(detectUiLang()); }
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
  status: null, // { key, vars, isError } so it can be re-rendered in another language
  photo: { busy: false, status: null, undo: null },
};

/* ------------------------------------------------------------------ host */

async function connect() {
  try {
    const mod = await import(SDK_URL);
    state.anna = await mod.AnnaAppRuntime.connect();
    $("#conn").classList.add("on");
    state.anna.window.set_title({ title: "Caption Studio" }).catch(() => {});
  } catch (e) {
    state.anna = null;
    console.info("[caption-studio] preview mode:", e?.message || e);
  }
  $("#conn").title = t(state.anna ? "conn.on" : "conn.preview");
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

/* -------------------------------------------------------------- language */

function applyStaticText() {
  document.documentElement.lang = uiLang();
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll("[data-i18n-alt]")) el.alt = t(el.dataset.i18nAlt);
  $("#ui-lang").setAttribute("aria-label", t("uiLang.label"));
}

function changeUiLang(id) {
  const before = uiLang();
  const now = setUiLang(id);
  try { localStorage.setItem(KEYS.uiLang, now); } catch {}
  save(KEYS.uiLang, now);

  // The copy language follows along, unless the user picked a different one.
  const copyLang = $("#language");
  if (copyLang.value === COPY_LANG_FOR_UI[before]) copyLang.value = COPY_LANG_FOR_UI[now];

  renderUi();
}

// Re-render everything that carries interface text.
function renderUi() {
  applyStaticText();
  $("#ui-lang").value = uiLang();
  applyTheme($("#theme").dataset.theme || "auto");
  $("#conn").title = t(state.anna ? "conn.on" : "conn.preview");
  for (const chip of document.querySelectorAll("#platforms .chip")) {
    chip.querySelector(".pname").textContent = pName(PLATFORMS.find((p) => p.id === chip.dataset.id));
  }
  renderBrands();
  renderStatus();
  renderPhotoStatus();
  renderResults();
  renderHistory();
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

function extractJson(raw) {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return JSON.parse(text.slice(start, end + 1));
}

function parseVariants(raw) {
  const data = extractJson(raw);
  if (!data) throw new Error(t("err.noCopy"));
  const list = Array.isArray(data.variants) ? data.variants : [];
  const clean = list
    .map((v) => ({
      text: String(v.text || "").trim(),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : [])
        .map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "").trim())
        .filter(Boolean),
    }))
    .filter((v) => v.text);
  if (!clean.length) throw new Error(t("err.empty"));
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

/* ----------------------------------------------------------- photo input */

const PHOTO_MAX_SIDE = 1280;

class PhotoError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const PHOTO_SYSTEM = `You identify products in photos for small online sellers.
Describe only what is clearly visible. Respond with JSON only, no markdown fences.`;

function photoPrompt(language) {
  return `Look at the product in this photo and fill in a product brief.
Return exactly: {"product":"...","details":"..."}
- product: a short, plain product name, at most 8 words.
- details: comma-separated facts a buyer would care about that you can SEE: type, colours, shape, pattern, finish, style, how it is used or shown, and any text printed on the product.
- Never guess size, weight, capacity, price, brand, origin or materials that are not obvious from the photo.
- If no product is visible, return {"product":"","details":""}.
Write both values in ${language}.`;
}

// Read a file into a resized JPEG (keeps uploads small and decodes HEIC-free
// formats the browser understands). data: URLs only, as the app's CSP allows.
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new PhotoError("FORMAT"));
    const reader = new FileReader();
    reader.onerror = () => reject(new PhotoError("FORMAT"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new PhotoError("FORMAT"));
      img.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // transparent PNGs would turn black as JPEG
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl, b64: dataUrl.split(",", 2)[1] });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function askVision(prompt, b64) {
  if (!state.anna) {
    await new Promise((r) => setTimeout(r, 700));
    return JSON.stringify({ product: "Handmade ceramic mug", details: "matte sand-coloured glaze, rounded shape, wide handle, photographed on a wooden table" });
  }
  const res = await state.anna.llm.complete({
    systemPrompt: PHOTO_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", data: b64, mimeType: "image/jpeg" }] }],
    maxTokens: 400,
    temperature: 0.2,
  });
  return completionText(res);
}

function setPhotoStatus(key, vars = {}, isError = false) {
  state.photo.status = key ? { key, vars, isError } : null;
  renderPhotoStatus();
}

function renderPhotoStatus() {
  const s = state.photo.status;
  const el = $("#photo-status");
  el.textContent = s ? t(s.key, s.vars) : "";
  el.classList.toggle("error", !!s?.isError);
}

function resetPhoto() {
  state.photo.undo = null;
  setPhotoStatus(null);
  $("#photo-preview").hidden = true;
  $("#photo-drop").hidden = false;
  $("#photo-img").removeAttribute("src");
  $("#photo-undo").hidden = true;
  $("#photo-input").value = "";
}

async function handlePhoto(file) {
  if (state.photo.busy || !file) return;
  let img;
  try {
    img = await readImageFile(file);
  } catch {
    setStatus("photo.errFormat", {}, true);
    return;
  }

  state.photo.busy = true;
  $("#photo").classList.add("busy");
  $("#photo-img").src = img.dataUrl;
  $("#photo-drop").hidden = true;
  $("#photo-preview").hidden = false;
  $("#photo-undo").hidden = true;
  setPhotoStatus("photo.reading");

  try {
    const data = extractJson(await askVision(photoPrompt($("#language").value), img.b64));
    const product = String(data?.product || "").trim().slice(0, 120);
    const details = String(data?.details || "").trim().slice(0, 1500);
    if (!product) throw new PhotoError("EMPTY");

    state.photo.undo = { product: $("#product").value, details: $("#details").value };
    $("#product").value = product;
    $("#details").value = details;
    $("#photo-undo").hidden = false;
    setPhotoStatus("photo.done");
  } catch (err) {
    const where = `${err?.code || ""} ${err?.name || ""} ${err?.message || ""}`;
    if (err?.code === "EMPTY") setPhotoStatus("photo.errEmpty", {}, true);
    else if (/VISION/i.test(where)) setPhotoStatus("photo.errVision", {}, true);
    else setPhotoStatus("photo.err", { reason: friendlyError(err) }, true);
  } finally {
    state.photo.busy = false;
    $("#photo").classList.remove("busy");
  }
}

function undoPhoto() {
  const u = state.photo.undo;
  if (!u) return;
  $("#product").value = u.product;
  $("#details").value = u.details;
  state.photo.undo = null;
  $("#photo-undo").hidden = true;
  setPhotoStatus("photo.undone");
}

function wirePhoto() {
  const zone = $("#photo");
  $("#photo-drop").addEventListener("click", () => $("#photo-input").click());
  $("#photo-input").addEventListener("change", (e) => {
    handlePhoto(e.target.files?.[0]);
    e.target.value = ""; // so the same file can be picked again
  });
  $("#photo-remove").addEventListener("click", resetPhoto);
  $("#photo-undo").addEventListener("click", undoPhoto);

  zone.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    handlePhoto(e.dataTransfer?.files?.[0]);
  });

  // Pasting an image anywhere outside the brand dialog uses it as the photo.
  document.addEventListener("paste", (e) => {
    if ($("#brand-dialog").open) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
    if (!file) return;
    e.preventDefault();
    handlePhoto(file);
  });
}

/* ---------------------------------------------------------------- brands */

function activeBrand() {
  return state.brands.find((b) => b.id === state.activeBrandId) || state.brands[0] || DEFAULT_BRAND;
}

// The untouched default brand shows its name in the interface language.
const brandLabel = (b) => (b.id === DEFAULT_BRAND.id && b.name === DEFAULT_BRAND.name ? t("brand.default") : b.name);

function renderBrands() {
  const sel = $("#brand");
  sel.innerHTML = "";
  for (const b of state.brands) sel.add(new Option(brandLabel(b), b.id, false, b.id === state.activeBrandId));
  sel.add(new Option(t("brand.new"), "__new"));
}

function openBrandDialog(brand) {
  const isNew = !brand;
  const b = brand || { ...DEFAULT_BRAND, id: "", name: "" };
  $("#b-name").value = brand ? brandLabel(b) : "";
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
    name: $("#b-name").value.trim() || t("brand.default"),
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
  toast(t("toast.brandSaved"));
}

/* ------------------------------------------------------------------ form */

function renderForm() {
  const ui = $("#ui-lang");
  for (const l of UI_LANGS) ui.add(new Option(l.label, l.id));

  const box = $("#platforms");
  for (const p of PLATFORMS) {
    const l = document.createElement("label");
    l.className = "chip";
    l.dataset.id = p.id;
    l.style.setProperty("--c", p.color);
    l.innerHTML = `<input type="checkbox" value="${p.id}"><span class="dot"></span><span class="pname"></span>`;
    l.querySelector(".pname").textContent = pName(p);
    box.append(l);
  }

  const lang = $("#language");
  for (const l of LANGUAGES) lang.add(new Option(l, l));
  const guess = { es: "Español", fr: "Français", it: "Italiano", pt: "Português", nl: "Nederlands", pl: "Polski", tr: "Türkçe", ja: "日本語", ko: "한국어" }[(navigator.language || "en").slice(0, 2)];
  lang.value = guess || COPY_LANG_FOR_UI[uiLang()] || "English";
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
  if (b.language && LANGUAGES.includes(b.language)) $("#language").value = b.language;
  if (b.count) $("#count").value = String(b.count);
  for (const i of document.querySelectorAll("#platforms input")) i.checked = (b.platforms || []).includes(i.value);
}

function setStatus(key, vars = {}, isError = false) {
  state.status = key ? { key, vars, isError } : null;
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  const el = $("#status");
  el.textContent = s ? t(s.key, s.vars) : "";
  el.classList.toggle("error", !!s?.isError);
}

/* -------------------------------------------------------------- generate */

async function generate(e) {
  e.preventDefault();
  if (state.busy) return;
  const brief = readBrief();
  if (!brief.product) return setStatus("status.needProduct", {}, true);
  if (!brief.platforms.length) return setStatus("status.needPlatform", {}, true);

  state.busy = true;
  $("#go").disabled = true;
  const brand = activeBrand();
  const byPlatform = {};
  const errors = [];
  let done = 0;
  setStatus("status.progress", { done: 0, n: brief.platforms.length });

  // Two requests at a time keeps it quick without hammering the host quota.
  const queue = [...brief.platforms];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const p = PLATFORMS.find((x) => x.id === id);
      try {
        byPlatform[id] = parseVariants(await ask(buildPrompt(brief, p, brand)));
      } catch (err) {
        errors.push(`${pName(p)}: ${friendlyError(err)}`);
      }
      done++;
      setStatus("status.progress", { done, n: brief.platforms.length });
    }
  }
  await Promise.all([worker(), worker()]);

  state.busy = false;
  $("#go").disabled = false;

  const ids = brief.platforms.filter((id) => byPlatform[id]);
  if (!ids.length) {
    if (errors.length) setStatus("status.partial", { errors: errors.join(" · ") }, true);
    else setStatus("status.nothing", {}, true);
    return;
  }
  state.results = { brief, brand: brand.name, byPlatform, at: Date.now() };
  state.tab = ids[0];
  renderResults();
  if (errors.length) setStatus("status.partial", { errors: errors.join(" · ") }, true);
  else setStatus("status.done");

  state.history.unshift(state.results);
  state.history = state.history.slice(0, 12);
  renderHistory();
  save(KEYS.history, state.history);
  save(KEYS.last, brief);
}

function friendlyError(err) {
  // Host errors carry a code (QUOTA_EXCEEDED…); a plain Error's name is just "Error".
  const name = `${err?.code || ""} ${err?.name || ""}`;
  if (/QUOTA|RATE/i.test(name)) return t("err.quota");
  if (/PERMISSION|DENIED|ACL/i.test(name)) return t("err.permission");
  if (err instanceof SyntaxError) return t("err.cutoff");
  return err?.message || t("err.generic");
}

/* --------------------------------------------------------------- results */

function renderResults() {
  const r = state.results;
  const tabs = $("#tabs");
  const box = $("#results");
  if (!r) return; // keep the empty state
  tabs.innerHTML = "";
  box.innerHTML = "";

  const ids = r.brief.platforms.filter((id) => r.byPlatform[id]);
  tabs.setAttribute("role", "tablist");
  for (const id of ids) {
    const p = PLATFORMS.find((x) => x.id === id);
    const tb = document.createElement("button");
    tb.className = "tab";
    tb.type = "button";
    tb.setAttribute("role", "tab");
    tb.setAttribute("aria-selected", String(id === state.tab));
    tb.style.setProperty("--c", p.color);
    tb.textContent = `${pName(p)} (${r.byPlatform[id].length})`;
    tb.dataset.id = id;
    tb.onclick = () => { state.tab = id; renderResults(); };
    tabs.append(tb);
  }

  if (ids.length > 1) {
    const all = button(t("copyAll"), "mini copy-all", () => {
      copy(allText(r, ids), t("toast.copiedN", { n: ids.length }));
    });
    tabs.append(all);
  }

  const p = PLATFORMS.find((x) => x.id === state.tab);
  r.byPlatform[state.tab].forEach((v, i) => box.append(renderTag(p, v, i)));
}

function fullText(v) {
  return v.hashtags.length ? `${v.text}\n\n${v.hashtags.map((h) => "#" + h).join(" ")}` : v.text;
}

function allText(r, ids) {
  return ids.map((id) => {
    const p = PLATFORMS.find((x) => x.id === id);
    const variants = r.byPlatform[id].map((v, i) => `${t("variant", { i: i + 1 })}\n${fullText(v)}`).join("\n\n");
    return `===== ${pName(p)} =====\n\n${variants}`;
  }).join("\n\n\n");
}

/* Sharing. X and LinkedIn open a pre-filled post; Instagram, TikTok and
   Pinterest have no way to pre-fill text from a link, so the text is copied
   and the site opens for the user to paste it next to their photo or video. */
const enc = encodeURIComponent;
const SHARE = {
  x:         { label: () => t("share.x"),        prefill: true,  url: (s) => `https://x.com/intent/tweet?text=${enc(s)}` },
  linkedin:  { label: () => t("share.linkedin"), prefill: true,  url: (s) => `https://www.linkedin.com/feed/?shareActive=true&text=${enc(s)}` },
  instagram: { label: () => t("share.open", { platform: "Instagram" }), prefill: false, url: () => "https://www.instagram.com/" },
  tiktok:    { label: () => t("share.open", { platform: "TikTok" }),    prefill: false, url: () => "https://www.tiktok.com/upload" },
  pinterest: { label: () => t("share.open", { platform: "Pinterest" }), prefill: false, url: () => "https://www.pinterest.com/pin-builder/" },
};

function share(p, v) {
  const s = SHARE[p.id];
  const text = fullText(v);
  // Open first, inside the click, so the browser treats it as user-initiated.
  window.open(s.url(text), "_blank", "noopener,noreferrer");
  copy(text, t(s.prefill ? "toast.sharePrefill" : "toast.shareCopy", { platform: pName(p) }));
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
  meter.innerHTML = `<div class="meter-bar"><div class="meter-fill" style="width:${pct}%"></div></div><div class="meter-label"></div>`;
  meter.querySelector(".meter-label").textContent =
    t("meter", { len, limit: p.limit }) + (len > p.limit ? t("meter.over", { platform: pName(p) }) : "");

  const actions = document.createElement("div");
  actions.className = "tag-actions";
  const shorten = button(t("btn.shorter"), "mini shorten", () => rewrite(el, p, index, "shorter"));
  const lengthen = button(t("btn.longer"), "mini lengthen", () => rewrite(el, p, index, "longer"));

  if (SHARE[p.id]) {
    const sh = button(SHARE[p.id].label(), "mini share", () => share(p, v));
    sh.title = t(SHARE[p.id].prefill ? "share.titlePrefill" : "share.titleCopy", { platform: pName(p) });
    actions.append(sh);
  }
  actions.append(
    button(t("copy"), "mini copy", () => copy(fullText(v))),
    shorten,
    lengthen,
    button(t("btn.warmer"), "mini", () => rewrite(el, p, index, "warmer")),
    button(t("btn.cta"), "mini", () => rewrite(el, p, index, "cta")),
  );
  applyLengthLimits(actions, p, v);

  el.append(text);
  if (v.hashtags.length) el.append(tags);
  el.append(meter, actions);
  return el;
}

// Switch off Shorter/Longer when a text can't move further in that direction.
function applyLengthLimits(scope, p, v) {
  const s = scope.querySelector(".mini.shorten");
  const l = scope.querySelector(".mini.lengthen");
  if (s) {
    s.disabled = !canShorten(v);
    s.title = s.disabled ? t("limit.short") : "";
  }
  if (l) {
    l.disabled = !canLengthen(p, v);
    l.title = l.disabled ? t("limit.long", { platform: pName(p) }) : "";
  }
}

function button(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

/* ------------------------------------------------------------- rewrites */

const charLen = (s) => [...String(s)].length;

// Chinese, Japanese and Korean pack far more meaning into one character.
const isDense = (s) => (String(s).match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length > charLen(s) * 0.3;

// Below this a text has no room left to shorten without losing its point.
const minLength = (s) => (isDense(s) ? 20 : 50);

const canShorten = (v) => charLen(v.text) > minLength(v.text);

// Longest text (hashtags excluded) that still reads well on each platform,
// and never past the platform's hard limit once the hashtags are added.
const COMFORT_MAX = { shop: 1500, instagram: 1200, tiktok: 600, pinterest: 500, linkedin: 1500, x: 280 };

function maxLength(p, v) {
  const hashtagChars = charLen(fullText(v)) - charLen(v.text);
  return Math.min(COMFORT_MAX[p.id] || p.limit, p.limit - hashtagChars);
}

// Enough room left to add at least a short sentence.
const canLengthen = (p, v) => maxLength(p, v) - charLen(v.text) >= (isDense(v.text) ? 10 : 30);

// The platform guide without its word ranges ("40–90 words"). Sending the
// range made the model grow an already-short text back to the minimum.
const styleOnly = (guide) => guide.replace(/\s*\d+\s*[–-]\s*\d+\s*words\.?/gi, "").trim();

const REWRITES = {
  shorter: "Make it shorter. Cut whole phrases rather than rewording. Keep the strongest idea and the call to action.",
  longer: "Make it longer and richer. Add concrete detail from the product information above, a sensory moment or a use case. Keep the same voice, the same opening idea and the call to action. Never invent facts (prices, materials, sizes, awards, discounts) that are not in the product information.",
  warmer: "Make it warmer and more personal, as if the maker is talking. Keep about the same length.",
  cta: "Keep the idea but end with a clearer, more compelling call to action. Keep about the same length.",
};

function rewritePrompt(brand, p, brief, v, kind, maxChars) {
  const cur = charLen(v.text);
  const length = kind === "longer"
    ? `The new text must be longer than the current ${cur} characters, ideally around ${maxChars} characters, and at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`
    : `The new text must be at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`;
  return `${brandBlock(brand)}

Product: ${brief.product}
Product information: ${brief.details || "(none given beyond the current text)"}

Platform: ${p.name}
Style: ${styleOnly(p.guide)}
Language: ${brief.language}

Rewrite this ${p.name} text. ${REWRITES[kind]}
${length}
Use at most ${v.hashtags.length} hashtags.
Return exactly 1 variant.

Text:
${v.text}

Hashtags: ${v.hashtags.join(", ") || "(none)"}`;
}

async function rewrite(el, p, index, kind) {
  if (el.classList.contains("busy")) return;
  const r = state.results;
  const v = r.byPlatform[p.id][index];
  const brand = state.brands.find((b) => b.name === r.brand) || activeBrand();
  const cur = charLen(v.text);

  if (kind === "shorter" && !canShorten(v)) {
    toast(t("toast.atMin"));
    return;
  }
  if (kind === "longer" && !canLengthen(p, v)) {
    toast(t("toast.atMax", { platform: pName(p) }));
    return;
  }

  el.classList.add("busy");
  el.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    let next;
    if (kind === "shorter") {
      // Aim for about two thirds of the current length, then check the
      // result: one stricter retry, and never accept a text that got longer.
      const target = Math.max(minLength(v.text), Math.round(cur * 0.65));
      for (const maxChars of [target, Math.max(minLength(v.text), Math.round(cur * 0.5))]) {
        const [cand] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 700));
        if (charLen(cand.text) < cur) { next = cand; break; }
      }
      if (!next) throw new Error(t("err.noShorter"));
    } else if (kind === "longer") {
      // Mirror of Shorter: aim for about 1.4× the current length within the
      // platform's comfortable maximum, then check the result. One stricter
      // retry; never accept a text that got shorter or runs past the limit.
      const max = maxLength(p, v);
      const target = Math.min(max, Math.round(cur * 1.4) + 10);
      for (const maxChars of [target, Math.min(max, Math.round(cur * 1.25) + 10)]) {
        const [cand] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 900));
        const len = charLen(cand.text);
        if (len > cur && len <= max) { next = cand; break; }
      }
      if (!next) throw new Error(t("err.noLonger"));
    } else {
      const maxChars = Math.min(maxLength(p, v), Math.round(cur * 1.15) + 20);
      [next] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 700));
    }

    const hashtags = p.hashtags === 0 ? [] : (next.hashtags.length ? next.hashtags : v.hashtags).slice(0, Math.max(v.hashtags.length, 1));
    r.byPlatform[p.id][index] = { text: next.text, hashtags };
    save(KEYS.history, state.history);
    const fresh = renderTag(p, r.byPlatform[p.id][index], index);
    fresh.style.animationDelay = "0ms";
    el.replaceWith(fresh);
  } catch (err) {
    el.classList.remove("busy");
    el.querySelectorAll("button").forEach((b) => (b.disabled = false));
    applyLengthLimits(el, p, v);
    const action = { shorter: t("btn.shorter"), longer: t("btn.longer") }[kind] || t("action.rewrite");
    toast(t("toast.failed", { action, reason: friendlyError(err) }));
  }
}

async function copy(text, message = t("toast.copied")) {
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
  toast(message);
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* --------------------------------------------------------------- history */

function renderHistory() {
  const ul = $("#history");
  ul.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    const names = h.brief.platforms
      .filter((id) => h.byPlatform[id])
      .map((id) => pName(PLATFORMS.find((p) => p.id === id)))
      .join(", ");
    const b = button("", "", () => {
      state.results = h;
      state.tab = h.brief.platforms.find((id) => h.byPlatform[id]);
      applyBrief(h.brief);
      renderResults();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
  applyStaticText();
  $("#ui-lang").value = uiLang();
  applyTheme($("#theme").dataset.theme || "auto");

  $("#theme").addEventListener("click", () => {
    const next = THEMES[$("#theme").dataset.theme || "auto"].next;
    save(KEYS.theme, applyTheme(next));
  });
  $("#ui-lang").addEventListener("change", (e) => changeUiLang(e.target.value));
  wirePhoto();

  await connect();
  applyTheme(await load(KEYS.theme, $("#theme").dataset.theme || "auto"));

  // A language saved in the user's Anna account wins over this browser's guess.
  const savedLang = await load(KEYS.uiLang, null);
  if (savedLang && savedLang !== uiLang()) {
    setUiLang(savedLang);
    try { localStorage.setItem(KEYS.uiLang, uiLang()); } catch {}
  }

  state.brands = await load(KEYS.brands, [DEFAULT_BRAND]);
  if (!Array.isArray(state.brands) || !state.brands.length) state.brands = [DEFAULT_BRAND];
  state.activeBrandId = await load(KEYS.activeBrand, state.brands[0].id);
  state.history = (await load(KEYS.history, [])) || [];

  const last = await load(KEYS.last, null);
  if (last) applyBrief(last);
  else {
    document.querySelector('#platforms input[value="instagram"]').checked = true;
    $("#language").value = COPY_LANG_FOR_UI[uiLang()] || $("#language").value;
  }

  if (!state.anna) setStatus("status.preview");
  renderUi();

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
    toast(t("toast.brandDeleted"));
  });
}

boot();
