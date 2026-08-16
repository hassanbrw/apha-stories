// ============================================================
//  yunwu.ai — EK key se sab: deepseek (script/prompts), claude (keywords),
//  gemini (video analysis), gpt-image-2 (thumbnail).
//
//  NOTE (tested): video sirf Gemini NATIVE endpoint se chalta hai
//  (/v1beta/models/<model>:generateContent). OpenAI-style /chat/completions
//  video ko chup-chaap phenk deta hai.
// ============================================================
const fs = require('fs');
const path = require('path');
const U = require('./util.js');

const OPENAI = 'https://yunwu.ai/v1';
const NATIVE = 'https://yunwu.ai/v1beta';
const OR = 'https://openrouter.ai/api/v1';

// Model ka naam "or:" se shuru ho to OpenRouter par jata hai, warna yunwu.
// Misaal: "or:deepseek/deepseek-chat"  ya  "gemini-2.5-flash"
const isOR = m => String(m).startsWith('or:');
const bare = m => String(m).replace(/^or:/, '');

function key(model) {
  const e = U.env();
  if (isOR(model)) {
    if (!e.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY nahi mili (.env dekho)');
    return e.OPENROUTER_API_KEY;
  }
  if (!e.YUNWU_API_KEY) throw new Error('YUNWU_API_KEY nahi mili (.env dekho)');
  return e.YUNWU_API_KEY;
}

// yunwu par 429 ("upstream load is saturated") aur 5xx aam hain — ye aarzi hote
// hain, is liye backoff ke sath dobara koshish karte hain. 9-stage pipeline mein
// ek aarzi 429 poora kaam nahi rok sakta.
const RETRY_ON = [408, 429, 500, 502, 503, 504, 524];

async function post(url, body, extraHeaders = {}, timeoutMs = 300000, tries = 5, model = '') {
  let lastErr = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    let r, txt;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key(model)}`, ...extraHeaders },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      txt = await r.text();
    } catch (e) {
      lastErr = e.message;
      if (attempt === tries) throw new Error(`network fail (${tries} koshishen): ${lastErr}`);
      await sleep(attempt * 8000);
      continue;
    }
    if (r.ok) {
      try { return JSON.parse(txt); } catch { throw new Error(`JSON nahi mila: ${txt.slice(0, 300)}`); }
    }
    lastErr = `${r.status} ${r.statusText} — ${txt.slice(0, 200)}`;
    if (!RETRY_ON.includes(r.status) || attempt === tries) throw new Error(lastErr);
    const wait = attempt * 10000;
    console.log(`      [!] ${r.status} — ${Math.round(wait / 1000)}s baad dobara (koshish ${attempt + 1}/${tries})`);
    await sleep(wait);
  }
  throw new Error(lastErr);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Model ek naam ya LIST ho sakta hai. yunwu par kabhi ek model bhara hota hai
// (429 "upstream load is saturated") — us soorat mein agle model par chale jate
// hain. Is se "one click" ek busy endpoint par nahi rukta.
async function tryModels(models, fn) {
  const list = Array.isArray(models) ? models : [models];
  let last = '';
  for (let i = 0; i < list.length; i++) {
    try { return await fn(list[i]); }
    catch (e) {
      last = e.message;
      const busy = /429|saturat|rate|quota|502|503|504/i.test(last);
      if (i === list.length - 1) throw new Error(last);
      console.log(`      [!] ${list[i]} nahi chala (${busy ? 'busy' : last.slice(0, 50)}) → ${list[i + 1]}`);
    }
  }
  throw new Error(last);
}

// ---------- text (deepseek / claude / koi bhi chat model) ----------
async function chatOne(model, prompt, { system = '', maxTokens = 8000, temperature = 0.7 } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const url = isOR(model) ? `${OR}/chat/completions` : `${OPENAI}/chat/completions`;
  const d = await post(url, { model: bare(model), messages, max_tokens: maxTokens, temperature },
    {}, 300000, 5, model);
  const t = d?.choices?.[0]?.message?.content;
  if (!t) throw new Error(`khaali jawab: ${JSON.stringify(d).slice(0, 200)}`);
  return t.trim();
}

const chat = (models, prompt, opts = {}) => tryModels(models, m => chatOne(m, prompt, opts));

// JSON maangna ho to — LLM kabhi ```json ke andar deta hai, kabhi trailing comma
// chhod deta hai, kabhi string ke beech naya line daal deta hai. Isliye:
//   1) saaf karo aur parse karo
//   2) aam kharabiyan repair kar ke phir parse karo
//   3) phir bhi na bane to model se ek line ka minified JSON dobara mango
function extract(raw) {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = (fence ? fence[1] : raw).trim();
  const s = body.indexOf('['), s2 = body.indexOf('{');
  const start = s >= 0 && (s2 < 0 || s < s2) ? s : s2;
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (start >= 0 && end > start) body = body.slice(start, end + 1);
  return body;
}
function repair(body) {
  return body
    .replace(/[\u201c\u201d]/g, '"')          // smart quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')            // trailing comma
    .replace(/}\s*{/g, '},{')                 // missing comma between objects
    .replace(/"\s*\n\s*"/g, '" "')            // string ke beech naya line
    .replace(/([^\\])\n(?=[^"\n]*")/g, '$1 ');
}

async function chatJson(model, prompt, opts = {}) {
  const ask = prompt + '\n\nSirf valid JSON do — koi tashreeh nahi, koi markdown nahi.';
  let raw = await chat(model, ask, opts);
  for (const cand of [extract(raw), repair(extract(raw))]) {
    try { return JSON.parse(cand); } catch {}
  }
  // aakhri koshish: ek line ka minified JSON
  console.log('      [!] JSON toota — minified maang raha hun');
  raw = await chat(model, ask + '\n\nJawab EK LINE mein do, minified JSON, koi naya line nahi.',
    { ...opts, temperature: 0.2 });
  for (const cand of [extract(raw), repair(extract(raw))]) {
    try { return JSON.parse(cand); } catch {}
  }
  throw new Error(`JSON parse fail: ${extract(raw).slice(0, 200)}`);
}

// ---------- video analysis (Gemini NATIVE + inline base64) ----------
// Bare clips ke liye chhota hissa bhejo, warna base64 bahut bara ho jata hai.
const analyzeVideo = (models, videoPath, prompt) => tryModels(models, m => analyzeVideoOne(m, videoPath, prompt));

async function analyzeVideoOne(model, videoPath, prompt) {
  const b = fs.readFileSync(videoPath);
  if (b.length > 18 * 1024 * 1024) {
    throw new Error(`video bahut bari (${(b.length / 1048576).toFixed(1)} MB) — pehle chhota hissa banao`);
  }
  const d = await post(`${NATIVE}/models/${bare(model)}:generateContent`, {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'video/mp4', data: b.toString('base64') } },
    ] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  });
  const t = d?.candidates?.[0]?.content?.parts?.map(x => x.text).filter(Boolean).join('\n');
  if (!t) throw new Error(`khaali jawab: ${JSON.stringify(d).slice(0, 200)}`);
  return t.trim();
}

// ---------- image (thumbnail / avatar) ----------
const image = (models, prompt, dest, size) => tryModels(models, m => imageOne(m, prompt, dest, size));

async function imageOne(model, prompt, dest, size = '1536x1024') {
  // Image API kabhi kabhi latak jati hai. 5 minute intezaar mein poori raat
  // zaya hoti hai — 2 minute mein na aaye to agla model azma lo (naapa gaya:
  // 30 parallel par seedream aksar timeout hota hai, gpt-image-2 chal jata hai).
  const d = await post(`${OPENAI}/images/generations`, { model: bare(model), prompt, size, n: 1 }, {}, 120000, 4, model);
  const it = d?.data?.[0];
  if (it?.b64_json) fs.writeFileSync(dest, Buffer.from(it.b64_json, 'base64'));
  else if (it?.url) {
    const r = await fetch(it.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(300000) });
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  } else throw new Error(`na b64 na url: ${JSON.stringify(d).slice(0, 200)}`);
  return dest;
}

module.exports = { chat, chatJson, analyzeVideo, image };

// ---------- image edit (reference image ke sath = character consistency) ----------
async function imageEditOne(model, prompt, refPath, dest, size = '1536x1024') {
  const fd = new FormData();
  fd.append('model', bare(model));
  fd.append('prompt', prompt);
  fd.append('n', '1');
  fd.append('size', size);
  fd.append('image', new Blob([fs.readFileSync(refPath)]), path.basename(refPath));
  const r = await fetch(`${OPENAI}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key(model)}` },
    body: fd,
    signal: AbortSignal.timeout(150000),
  });
  const txt = await r.text();
  if (!r.ok) { const e = new Error(`${r.status} — ${txt.slice(0, 200)}`); e.status = r.status; throw e; }
  const it = JSON.parse(txt)?.data?.[0];
  if (it?.b64_json) fs.writeFileSync(dest, Buffer.from(it.b64_json, 'base64'));
  else if (it?.url) {
    const g = await fetch(it.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(300000) });
    fs.writeFileSync(dest, Buffer.from(await g.arrayBuffer()));
  } else throw new Error('na b64 na url');
  return dest;
}
async function imageEdit(models, prompt, refPath, dest, size) {
  return tryModels(models, m => imageEditOne(m, prompt, refPath, dest, size), 'image-edit');
}
module.exports.imageEdit = imageEdit;
