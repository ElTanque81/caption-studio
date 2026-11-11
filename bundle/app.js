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
  renderStrength();
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

/* The selling points. `facts` lives in the #details field. */
const POINTS = ["facts", "persona", "pain", "unique", "proof", "objection"];
const pointField = (k) => (k === "facts" ? "details" : k);

// Phrases that make copy sound like every other shop. Checked in code, and
// named in the prompt so the model avoids them in the first place.
const CLICHES = [
  "elevate", "game-changer", "game changer", "look no further", "whether you're", "introducing", "must-have",
  "unleash", "level up", "to the next level", "say goodbye to", "say hello to", "ultimate", "revolutionary",
  "seamless", "effortless", "in today's", "you deserve", "treat yourself", "the perfect gift", "dive into",
  "discover the", "experience the", "made with love", "crafted with love", "don't miss out", "high-quality",
  "premium quality", "best-in-class", "transform your", "next level", "redefine", "indulge in",
  "auf das nächste level", "ein muss", "gönn dir", "ultimativ", "revolutionär", "perfekt für jeden",
  "entdecke die", "mit liebe gemacht", "hochwertig", "verpasse nicht",
];

const SYSTEM = `You are a direct-response copywriter for small makers and online sellers. You write like a real person who knows the product well, not like an ad.
Rules:
- Build every text on the seller's selling points: who buys it, their problem, what is different, the proof. Reuse the seller's own concrete words and details.
- Open with something specific: a detail, a moment, a problem. Never open with a generic line, a slogan or a question about the reader's life.
- No hype words without a fact behind them. Never use: ${CLICHES.slice(0, 33).join(", ")}.
- Never invent facts: no numbers, ratings, reviews, awards, materials, origins, guarantees, prices or discounts that are not in the brief.
- Vary sentence length. At most one question and at most one exclamation mark per text.
Respond with JSON only, no markdown fences.`;

function briefBlock(b) {
  const v = (x) => x || "(not given)";
  return `Product: ${b.product}
Product facts: ${v(b.details)}
Buyer, and when they buy: ${v(b.persona)}
Problem or frustration it fixes: ${v(b.pain)}
What is different about it: ${v(b.unique)}
Proof (real, may be used): ${v(b.proof)}
Main doubt, and the seller's answer: ${v(b.objection)}
Call to action: ${b.cta || "(choose a natural one for the platform, without inventing offers)"}`;
}

function strategyPrompt(b, brand) {
  return `Find the ${b.count} strongest, clearly different angles for selling this product.

${brandBlock(brand)}

${briefBlock(b)}

An angle is one reason to buy, aimed at one buyer in one situation. Base every angle on the selling points above and invent nothing. Make the angles really different, for example: the problem it fixes, the craft behind it, the moment it is used, the person it is a gift for, the doubt it answers.
For each angle give: name (2 to 4 words), buyer (who, in a short phrase), promise (what they get, one sentence), hook (a specific opening idea, not a slogan), points (the selling points it rests on, from: ${POINTS.join(", ")}).
Write in ${b.language}.

Return exactly: {"angles":[{"id":"a1","name":"...","buyer":"...","promise":"...","hook":"...","points":["pain","unique"]}]}`;
}

function buildPrompt(brief, platform, brand, angles, feedback) {
  return `${brandBlock(brand)}

${briefBlock(brief)}

Platform: ${platform.name}
Format: ${platform.guide}
Hard limit: ${platform.limit} characters per text.
Hashtags per variant: ${platform.hashtags === 0 ? "none (empty array)" : `${Math.max(2, platform.hashtags - 3)}–${platform.hashtags}`}, specific to this product and buyer, not generic.
Language: write everything in ${brief.language}.

Write exactly ${angles.length} variants, one per angle, in this order:
${angles.map((a) => `- ${a.id}: ${a.name}. For ${a.buyer}. Promise: ${a.promise}. Hook idea: ${a.hook}`).join("\n")}

For each variant also list "uses": the selling points the text really uses, each with its field (${POINTS.join(", ")}) and the exact short phrase from YOUR text that carries it.${feedback ? `\n\nYour previous draft had problems. Fix them:\n${feedback}` : ""}

Return exactly: {"variants":[{"angle":"a1","text":"...","hashtags":["word"],"uses":[{"field":"pain","phrase":"..."}]}]}`;
}

function interviewPrompt(b) {
  return `A small seller wants copy for this product. Help them find the selling points that make it worth buying.

${briefBlock(b)}

Ask 3 or 4 short, specific questions about THIS product that the seller can answer from their own knowledge. Each question aims at one field: persona (who buys it and when), pain (the problem or frustration it fixes), unique (what is different: material, craft, process, origin), proof (reviews, numbers or guarantees they really have), objection (the main doubt and their answer). Skip fields the brief already answers well. Give each question a short example answer that shows the kind of detail you want; it is only an example, never a fact about their product.
Write in ${COPY_LANG_FOR_UI[uiLang()]}.

Return exactly: {"questions":[{"field":"pain","question":"...","example":"..."}]}`;
}

/* ------------------------------------------------------- quality checks */

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

function clichesIn(text) {
  const t0 = norm(text);
  return CLICHES.filter((c) => {
    if (/^[a-z]+$/.test(c)) return new RegExp(`\\b${c}\\b`, "i").test(t0);
    return t0.includes(c);
  });
}

const numTokens = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []);
const digitsOnly = (n) => n.replace(/[.,]/g, "");

// Numbers in the copy that the seller never gave (prices, ratings, counts…).
function inventedNumbers(text, brief) {
  const source = [brief.product, brief.details, brief.persona, brief.pain, brief.unique, brief.proof, brief.objection, brief.cta].join(" ");
  const allowed = new Set(numTokens(source).flatMap((n) => [n.replace(",", "."), digitsOnly(n)]));
  return [...new Set(numTokens(text))].filter((n) => n !== "1" && !allowed.has(n.replace(",", ".")) && !allowed.has(digitsOnly(n)));
}

const filledPoints = (b) => POINTS.filter((k) => (b[pointField(k)] || "").trim());

// Keep only the "uses" the text really contains, for fields the seller filled.
function verifiedUses(v, brief) {
  const filled = new Set(filledPoints(brief));
  const text = norm(v.text);
  const fields = [];
  for (const u of v.uses || []) {
    const phrase = norm(u?.phrase || "");
    if (phrase.length >= 3 && POINTS.includes(u.field) && filled.has(u.field) && text.includes(phrase) && !fields.includes(u.field)) fields.push(u.field);
  }
  return fields;
}

function checkVariant(v, brief) {
  const cliches = clichesIn(v.text);
  const invented = inventedNumbers(v.text, brief);
  const uses = verifiedUses(v, brief);
  const weak = filledPoints(brief).length >= 2 && uses.length < 2;
  return { cliches, invented, uses, weak, score: cliches.length * 2 + invented.length * 3 + (weak ? 2 : 0) };
}

function feedbackFor(variants, checks) {
  return variants.map((v, i) => {
    const c = checks[i];
    const parts = [];
    if (c.cliches.length) parts.push(`remove the clichés ${c.cliches.map((x) => `"${x}"`).join(", ")} and say something concrete instead`);
    if (c.invented.length) parts.push(`remove these numbers, they are not in the brief: ${c.invented.join(", ")}`);
    if (c.weak) parts.push("build it on at least two of the seller's selling points, using their concrete details");
    return parts.length ? `- ${v.angle || `variant ${i + 1}`}: ${parts.join("; ")}.` : "";
  }).filter(Boolean).join("\n");
}

const sumScore = (checks) => checks.reduce((s, c) => s + c.score, 0);

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
      angle: typeof v.angle === "string" ? v.angle : undefined,
      text: String(v.text || "").trim(),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : [])
        .map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "").trim())
        .filter(Boolean),
      uses: Array.isArray(v.uses) ? v.uses.filter((u) => u && typeof u === "object") : [],
    }))
    .filter((v) => v.text);
  if (!clean.length) throw new Error(t("err.empty"));
  return clean;
}

function parseAngles(raw, count) {
  const data = extractJson(raw);
  const list = (Array.isArray(data?.angles) ? data.angles : [])
    .map((a, i) => ({
      id: `a${i + 1}`,
      name: String(a.name || "").trim(),
      buyer: String(a.buyer || "").trim(),
      promise: String(a.promise || "").trim(),
      hook: String(a.hook || "").trim(),
      points: (Array.isArray(a.points) ? a.points : []).filter((p) => POINTS.includes(p)),
    }))
    .filter((a) => a.name && a.promise)
    .slice(0, count);
  if (!list.length) throw new Error(t("err.empty"));
  return list;
}

function parseQuestions(raw) {
  const data = extractJson(raw);
  const asks = ["persona", "pain", "unique", "proof", "objection"];
  return (Array.isArray(data?.questions) ? data.questions : [])
    .map((q) => ({ field: asks.includes(q.field) ? q.field : "unique", question: String(q.question || "").trim(), example: String(q.example || "").trim() }))
    .filter((q) => q.question)
    .slice(0, 4);
}

function completionText(res) {
  const c = res && res.content;
  if (!c) return "";
  if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => b.text).join("");
  return c.text || "";
}

async function ask(userPrompt, maxTokens = 1400, temperature = 0.8) {
  if (!state.anna) return demoAnswer(userPrompt);
  const res = await state.anna.llm.complete({
    systemPrompt: SYSTEM,
    messages: [{ role: "user", content: { type: "text", text: userPrompt } }],
    maxTokens,
    temperature,
  });
  return completionText(res);
}

/* Canned output so the UI can be previewed in a normal browser. */
function demoAnswer(prompt) {
  const field = (label) => ((prompt.match(new RegExp(`\\n?${label}: (.*)`)) || [])[1] || "").replace("(not given)", "").trim();
  const product = field("Product") || "your product";
  const pain = field("Problem or frustration it fixes");
  const unique = field("What is different about it");
  let out;
  if (/strongest, clearly different angles/.test(prompt)) {
    out = { angles: [
      { name: "The problem, solved", buyer: field("Buyer, and when they buy") || "people who need it", promise: pain ? `No more: ${pain}.` : `${product} does one job well.`, hook: pain || product, points: ["pain"] },
      { name: "How it's made", buyer: "people who care how things are made", promise: unique || `What sets ${product} apart.`, hook: unique || product, points: ["unique"] },
      { name: "The everyday moment", buyer: "everyday users", promise: `${product}, in the moment you use it.`, hook: product, points: ["persona"] },
    ] };
  } else if (/Ask 3 or 4 short, specific questions/.test(prompt)) {
    out = { questions: [
      { field: "pain", question: `What annoys people about other ${product}s?`, example: "they break after a few months" },
      { field: "unique", question: `How is your ${product} made, and by whom?`, example: "by hand, in small batches" },
      { field: "proof", question: "What proof do you have that buyers like it?", example: "number of reviews, repeat buyers" },
    ] };
  } else {
    const ids = [...prompt.matchAll(/\n- (a\d): /g)].map((m) => m[1]);
    const n = /\nRewrite this /.test(prompt) ? 1 : Math.max(1, ids.length);
    const lines = [pain && `${pain}? Not with this one.`, unique && `${unique}.`, `${product}.`].filter(Boolean);
    out = { variants: Array.from({ length: n }, (_, i) => ({
      angle: ids[i], text: `${lines[i % lines.length]}\n\n${lines.join(" ")}`,
      hashtags: ["handmade", "shopsmall"],
      uses: [pain && { field: "pain", phrase: pain }, unique && { field: "unique", phrase: unique }].filter(Boolean),
    })) };
  }
  return new Promise((r) => setTimeout(() => r(JSON.stringify(out)), 600));
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
    renderStrength();
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
  renderStrength();
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
    persona: $("#persona").value.trim(),
    pain: $("#pain").value.trim(),
    unique: $("#unique").value.trim(),
    proof: $("#proof").value.trim(),
    objection: $("#objection").value.trim(),
    cta: $("#cta").value.trim(),
    language: $("#language").value,
    count: Math.min(4, Number($("#count").value) || 3),
    platforms: [...document.querySelectorAll("#platforms input:checked")].map((i) => i.value),
  };
}

function applyBrief(b) {
  if (!b) return;
  for (const id of ["product", "details", "persona", "pain", "unique", "proof", "objection", "cta"]) $(`#${id}`).value = b[id] || "";
  if (b.language && LANGUAGES.includes(b.language)) $("#language").value = b.language;
  if (b.count) $("#count").value = String(Math.min(4, b.count));
  for (const i of document.querySelectorAll("#platforms input")) i.checked = (b.platforms || []).includes(i.value);
  renderStrength();
}

/* How much the brief gives the model to work with, and what to add next. */
const STRENGTH_ORDER = ["pain", "unique", "persona", "proof", "facts"];

function renderStrength() {
  const b = readBrief();
  const filled = STRENGTH_ORDER.filter((k) => (b[pointField(k)] || "").length >= 8);
  const level = filled.length >= 4 ? 2 : filled.length >= 2 ? 1 : 0;
  const next = STRENGTH_ORDER.find((k) => !filled.includes(k));
  const box = $("#strength");
  box.dataset.level = String(level);
  box.querySelectorAll(".strength-bar span").forEach((s, i) => s.classList.toggle("on", i < filled.length));
  $("#strength-label").textContent = t(`strength.${level}`);
  $("#strength-tip").textContent = next ? t(`tip.${next}`) : t("tip.done");
}

/* ------------------------------------------------- selling-point interview */

async function startInterview() {
  const b = readBrief();
  if (!b.product) {
    $("#interview-status").textContent = t("interview.need");
    $("#product").focus();
    return;
  }
  const btn = $("#interview-btn");
  btn.disabled = true;
  $("#interview-status").textContent = t("interview.loading");
  try {
    const questions = parseQuestions(await ask(interviewPrompt(b), 700, 0.6));
    if (!questions.length) throw new Error(t("err.empty"));
    const box = $("#interview-questions");
    box.innerHTML = "";
    questions.forEach((q, i) => {
      const f = document.createElement("div");
      f.className = "field";
      const label = document.createElement("label");
      label.htmlFor = `iq-${i}`;
      label.textContent = q.question;
      const input = document.createElement("input");
      input.id = `iq-${i}`;
      input.dataset.field = q.field;
      input.maxLength = 300;
      if (q.example) input.placeholder = t("interview.example", { text: q.example });
      f.append(label, input);
      box.append(f);
    });
    $("#interview-panel").hidden = false;
    $("#interview-status").textContent = "";
    $("#iq-0")?.focus();
  } catch (err) {
    $("#interview-status").textContent = t("interview.err", { reason: friendlyError(err) });
  } finally {
    btn.disabled = false;
  }
}

function addInterviewAnswers() {
  let added = 0;
  for (const input of document.querySelectorAll("#interview-questions input")) {
    const answer = input.value.trim();
    if (!answer) continue;
    const target = $(`#${input.dataset.field}`);
    target.value = target.value.trim() ? `${target.value.trim()}; ${answer}` : answer;
    added++;
  }
  $("#interview-panel").hidden = true;
  $("#interview-questions").innerHTML = "";
  $("#interview-status").textContent = added ? t("interview.added") : "";
  renderStrength();
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

// Write one platform: draft, check, and redraft once if the check finds
// clichés, invented numbers or copy that ignores the selling points.
async function writePlatform(brief, p, brand, angles) {
  const draft = async (feedback) => {
    const variants = parseVariants(await ask(buildPrompt(brief, p, brand, angles, feedback)));
    variants.forEach((v, i) => { if (!angles.some((a) => a.id === v.angle)) v.angle = angles[i]?.id; });
    return { variants, checks: variants.map((v) => checkVariant(v, brief)) };
  };
  let best = await draft();
  if (sumScore(best.checks) > 0) {
    try {
      const retry = await draft(feedbackFor(best.variants, best.checks));
      if (sumScore(retry.checks) < sumScore(best.checks)) best = retry;
    } catch {
      // Keep the first draft; its remaining issues are shown on the variants.
    }
  }
  return best.variants.map((v, i) => ({
    angle: v.angle,
    text: v.text,
    hashtags: v.hashtags,
    uses: best.checks[i].uses,
    invented: best.checks[i].invented,
  }));
}

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

  // Stage 1: the angles. Every platform's copy is then built on them.
  setStatus("status.strategy");
  let angles;
  try {
    angles = parseAngles(await ask(strategyPrompt(brief, brand), 900, 0.7), brief.count);
  } catch (err) {
    state.busy = false;
    $("#go").disabled = false;
    setStatus("status.partial", { errors: friendlyError(err) }, true);
    return;
  }

  // Stage 2: one variant per angle on each platform, checked in code and
  // redrafted once with specific feedback if it is generic, invents numbers
  // or ignores the seller's selling points.
  setStatus("status.progress", { done: 0, n: brief.platforms.length });
  const queue = [...brief.platforms];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const p = PLATFORMS.find((x) => x.id === id);
      try {
        byPlatform[id] = await writePlatform(brief, p, brand, angles);
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
  state.results = { brief, brand: brand.name, angles, byPlatform, at: Date.now() };
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
  renderAngles(r);

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

const angleOf = (r, v) => (r.angles || []).find((a) => a.id === v.angle);

function renderAngles(r) {
  const box = $("#angle-list");
  box.innerHTML = "";
  $("#angles").hidden = !(r.angles && r.angles.length);
  for (const a of r.angles || []) {
    const card = document.createElement("article");
    card.className = "angle";
    const name = document.createElement("h3");
    name.textContent = a.name;
    const who = document.createElement("p");
    who.className = "angle-who";
    who.textContent = t("angle.for", { who: a.buyer });
    const promise = document.createElement("p");
    promise.className = "angle-promise";
    promise.textContent = a.promise;
    card.append(name, who, promise);
    box.append(card);
  }
}

function usesLine(v) {
  const wrap = document.createElement("div");
  wrap.className = "uses";
  if (v.uses?.length) {
    const label = document.createElement("span");
    label.className = "uses-label";
    label.textContent = t("uses.label");
    wrap.append(label);
    for (const f of v.uses) {
      const chip = document.createElement("span");
      chip.className = "use";
      chip.textContent = t(`field.${f}`);
      wrap.append(chip);
    }
  }
  if (v.invented?.length) {
    const warn = document.createElement("span");
    warn.className = "use warn";
    warn.textContent = t("check.numbers", { nums: v.invented.join(", ") });
    wrap.append(warn);
  }
  return wrap;
}

function fullText(v) {
  return v.hashtags.length ? `${v.text}\n\n${v.hashtags.map((h) => "#" + h).join(" ")}` : v.text;
}

function allText(r, ids) {
  return ids.map((id) => {
    const p = PLATFORMS.find((x) => x.id === id);
    const variants = r.byPlatform[id].map((v, i) => `${angleOf(r, v)?.name || t("variant", { i: i + 1 })}\n${fullText(v)}`).join("\n\n");
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

  const angle = state.results ? angleOf(state.results, v) : null;
  if (angle) {
    const a = document.createElement("p");
    a.className = "tag-angle";
    a.textContent = angle.name;
    el.append(a);
  }
  el.append(text);
  if (v.hashtags.length) el.append(tags);
  if (v.uses?.length || v.invented?.length) el.append(usesLine(v));
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
  longer: "Make it longer and richer. Add concrete detail from the selling points above, a sensory moment or a use case. Keep the same voice, the same opening idea and the call to action. Never invent facts (prices, materials, sizes, awards, discounts) that are not in the brief.",
  warmer: "Make it warmer and more personal, as if the maker is talking. Keep about the same length.",
  cta: "Keep the idea but end with a clearer, more compelling call to action. Keep about the same length.",
};

function rewritePrompt(brand, p, brief, v, kind, maxChars) {
  const cur = charLen(v.text);
  const length = kind === "longer"
    ? `The new text must be longer than the current ${cur} characters, ideally around ${maxChars} characters, and at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`
    : `The new text must be at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`;
  return `${brandBlock(brand)}

${briefBlock(brief)}

Platform: ${p.name}
Style: ${styleOnly(p.guide)}
Language: ${brief.language}

Rewrite this ${p.name} text. ${REWRITES[kind]}
${length}
Use at most ${v.hashtags.length} hashtags.
Return exactly 1 variant, with "uses": the selling points the new text uses (${POINTS.join(", ")}) and the exact phrase from the new text that carries each.
Shape: {"variants":[{"text":"...","hashtags":["word"],"uses":[{"field":"pain","phrase":"..."}]}]}

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
    const check = checkVariant(next, r.brief);
    r.byPlatform[p.id][index] = { angle: v.angle, text: next.text, hashtags, uses: check.uses.length ? check.uses : v.uses, invented: check.invented };
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
  $("#interview-btn").addEventListener("click", startInterview);
  $("#interview-add").addEventListener("click", addInterviewAnswers);
  $("#interview-close").addEventListener("click", () => { $("#interview-panel").hidden = true; });
  for (const id of ["product", "details", "persona", "pain", "unique", "proof", "objection"]) $(`#${id}`).addEventListener("input", renderStrength);

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
