// ============================================================
//  STAGE 6 — IMAGES (Bulk Image tool = Gemini, browser automation)
//
//  Tool ko DO DAFA chalata hai:
//    1) character mode — reference/character/ mein avatar ki image,
//       to har tasveer mein WAHI banda (user ka hukm: ~60 images)
//    2) normal mode    — baqi (khet, barn, auction, tools)
//
//  Tool ka output: output/<id>/<id>_<n>.png  (prompt ki tarteeb mein)
//  Hum use timeline ke seconds par chipka dete hain:
//    images/img_SSSSS_EEEEE.png   → ffmpeg ko kuch sochna nahi padta
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const U = require('../lib/util.js');

const TOOL = path.resolve(U.ROOT, 'tools', 'gemini');

// Gemini tool sirf tab kaam karta hai jab koi profile Google mein logged in ho.
// Warna 0 images banti hain aur poori raat zaya. Is liye pehle check.
// AHEM: profiles yahan NAHI hoti (tools/gemini/profiles) — asli tool (lib/common.js
// ka PROFILE_DIR) aur setup/gemini-login.js dono studio ke sanjhe browser/gemini/
// istemal karte hain. Pehle ye function galat jagah dekh raha tha, is liye login
// hone ke bawajood "login nahi hua" ata tha.
function geminiUsable() {
  const pd = path.join(U.ROOT, 'browser', 'gemini');
  if (!fs.existsSync(pd)) return false;
  return fs.readdirSync(pd).some(n => {
    const d = path.join(pd, n);
    return fs.existsSync(path.join(d, 'Default', 'Network', 'Cookies')) && fs.existsSync(path.join(d, 'Local State'))
        && !fs.existsSync(path.join(d, '.logged-out'));
  });
}
// Tool ka apna safeId (common.js) — hyphen aur dot rakhta hai. Mera pehle
// sab kuch "_" kar deta tha, is liye output folder mila hi nahi.
const safeId = n => n.replace(/\.txt$/i, '').trim().replace(/\s+/g, '').replace(/[^\w.-]/g, '_');

const run = (args, cwd) => new Promise((res, rej) => {
  const p = spawn('node', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const t = setTimeout(() => { p.kill('SIGKILL'); rej(new Error('tool timeout (2h)')); }, 7200000);
  p.on('exit', c => { clearTimeout(t); c === 0 ? res() : rej(new Error(`tool exit ${c}`)); });
  p.on('error', rej);
});

module.exports = async function (spec, cfg, st) {
  const dest = U.p(spec.id, 'images');
  fs.mkdirSync(dest, { recursive: true });

  // ---------- backend chuno ----------
  // ⛔ Images SIRF Gemini browser tool se. Koi paid image API nahi (sakht rule).
  if (!fs.existsSync(TOOL)) throw new Error(`Gemini tool nahi mila: ${TOOL}`);
  if (!geminiUsable()) throw new Error(
    'Gemini browser login nahi hua.\n   chalao:  node setup/gemini-login.js');
  U.log('   backend: Gemini browser tool');

  const tp = path.join(TOOL, 'prompts');
  const refC = path.join(TOOL, 'reference', 'character');
  fs.mkdirSync(tp, { recursive: true });
  fs.mkdirSync(refC, { recursive: true });

  let total = 0;
  for (const mode of ['character', 'normal']) {
    const src = U.p(spec.id, 'prompts', `${mode}.txt`);
    const mapF = U.p(spec.id, 'prompts', `${mode}.map.json`);
    if (!fs.existsSync(src)) { U.log(`   ${mode}: koi prompt nahi — chhod diya`); continue; }
    const map = JSON.parse(fs.readFileSync(mapF, 'utf8'));

    // Sirf woh prompts bhejo jinki image abhi nahi bani. Poori list dobara
    // bhejne se Gemini ka rozana quota bekar mein khatam hota hai.
    const has = m => ['png','jpg','jpeg','webp'].some(e => fs.existsSync(path.join(dest, `img_${m.tag}.${e}`)));
    const lines = fs.readFileSync(src, 'utf8').split('\n')
      .map(x => x.trim()).filter(x => x && !x.startsWith('#'));
    const pending = map.map((m, k) => ({ ...m, prompt: lines[k] }))
                       .filter(m => m.prompt && !has(m));
    const already = map.length - pending.length;
    total += already;
    if (!pending.length) { U.log(`   ${mode}: sab ${map.length} pehle se ban chuki — chhod diya`); continue; }
    U.log(`   ${mode}: ${already}/${map.length} pehle se, ${pending.length} baqi`);

    // tool ke prompts/ mein SIRF baqi prompts
    for (const f of fs.readdirSync(tp)) if (f.endsWith('.txt')) fs.rmSync(path.join(tp, f), { force: true });
    const key = `${spec.id}-${mode}`;
    fs.writeFileSync(path.join(tp, `${key}.txt`), pending.map(m => m.prompt).join('\n') + '\n');
    fs.rmSync(path.join(TOOL, `state-${mode}.json`), { force: true });

    // character mode: avatar ki image reference mein
    if (mode === 'character') {
      const av = path.resolve(U.ROOT, spec.avatar || '');
      if (!fs.existsSync(av)) throw new Error(`character reference nahi mila: ${spec.avatar}`);
      for (const f of fs.readdirSync(refC)) fs.rmSync(path.join(refC, f), { force: true });
      fs.copyFileSync(av, path.join(refC, 'character' + path.extname(av)));
      U.log(`   character reference: ${path.basename(av)}`);
    }

    // normal mode, koi avatar nahi (config.images.characterConsistency=false):
    // is video ki apni THUMBNAIL (stage 1.7, images se pehle bani) ko STYLE
    // reference bana do — Gemini ka SC toggle use karta hai, taake poori
    // story ke images us thumbnail ke kirdaaron/rang/andaz se milte-julte hon.
    if (mode === 'normal' && cfg.images?.characterConsistency !== true) {
      const thumbDir = U.p(spec.id, 'thumbnail');
      const thumbRef = fs.existsSync(thumbDir)
        ? ['thumb_1.jpg', 'thumb_1.png', 'thumb_1.jpeg'].map(f => path.join(thumbDir, f)).find(fs.existsSync)
        : null;
      if (thumbRef) {
        // "key" (spec.id-mode) hi wahi string hai jo tool ke loadVideos() mein
        // v.key banta hai (resolveRefs isi se per-video ref folder dhoondta hai)
        const refS = path.join(TOOL, 'reference', key);
        fs.mkdirSync(refS, { recursive: true });
        for (const f of fs.readdirSync(refS)) fs.rmSync(path.join(refS, f), { force: true });
        fs.copyFileSync(thumbRef, path.join(refS, 'style' + path.extname(thumbRef)));
        U.log(`   style reference: this video's own thumbnail (${path.basename(thumbRef)})`);
      } else {
        // ASLI BUG: pehle sirf warn kar ke bina reference ke aage chal deta
        // tha — bina reference ke Gemini painterly/cartoon-jaisi images banata
        // hai (user ki shikayat). Ab hard-stop, taake ye dobara na ho —
        // thumbnail (stage 1.7) HAMESHA images (stage 6) se pehle chalni
        // chahiye. "--from=2" jaisa partial run istemal mat karo.
        throw new Error(
          'thumbnail abhi nahi bani — bina style reference ke images cartoonish/painterly ban'
          + ' jati hain. Pehle chalao: node run.js --video="' + spec.id + '" --only=thumbnail'
          + '\n   Ya poora pipeline shuru se: --from=1 (ya --from=1.7), "--from=2" mat karo (thumbnail chhoot jati hai).');
      }
    }

    // purana output hata do, warna seq numbers purani files se takra jate hain
    fs.rmSync(path.join(TOOL, 'output', safeId(`${spec.id}-${mode}`)), { recursive: true, force: true });
    U.log(`   ${mode} mode — ${pending.length} prompts — browser khul raha hai...`);
    await run([path.join(TOOL, 'lib', 'run.js'), mode], TOOL);

    // ---- output ko seconds ke naam par ----
    const outDir = path.join(TOOL, 'output', safeId(key));
    if (!fs.existsSync(outDir)) { U.warn(`${mode}: output folder nahi bana`); continue; }
    const files = fs.readdirSync(outDir)
      .filter(f => /_(\d+)\.(png|jpe?g|webp)$/i.test(f))
      .map(f => ({ f, n: +f.match(/_(\d+)\.[a-z]+$/i)[1] }))
      .sort((a, b) => a.n - b.n);

    let n = 0;
    for (const { f, n: seq } of files) {
      const m = pending[seq - 1];                   // seq 1 = pehla bheja gaya prompt
      if (!m) continue;
      fs.copyFileSync(path.join(outDir, f), path.join(dest, `img_${m.tag}${path.extname(f)}`));
      n++;
    }
    U.ok(`${mode}: ${n}/${pending.length} nayi images → images/`);
    total += n;
  }

  attach(spec, dest);
  if (!total) throw new Error('koi image nahi bani');
  st.meta.images = total;
  U.ok(`kul ${total} images`);
  return true;
};

// ---- har image slot par uska file chipka do; khaali ho to padosi image ----
function attach(spec, dest) {
  const tlF = U.p(spec.id, 'timeline.json');
  const timeline = JSON.parse(fs.readFileSync(tlF, 'utf8'));
  const have = f => fs.existsSync(path.join(dest, f));
  let filled = 0, last = null;
  for (const s of timeline.filter(x => x.kind === 'image')) {
    const tag = `${String(Math.floor(s.start)).padStart(5, '0')}_${String(Math.floor(s.end)).padStart(5, '0')}`;
    const hit = ['png', 'jpg', 'jpeg', 'webp'].map(e => `img_${tag}.${e}`).find(have);
    if (hit) { s.file = `images/${hit}`; last = hit; }
    else if (last) { s.file = `images/${last}`; filled++; }
  }
  if (filled) U.warn(`${filled} slots khaali the — padosi image lagayi`);
  fs.writeFileSync(tlF, JSON.stringify(timeline, null, 1));
}
