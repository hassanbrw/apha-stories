// STAGE — thumbnail (gpt-image-2 via yunwu, Gemini browser tool par fallback)
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const U = require('../lib/util.js'), AI = require('../lib/ai.js');

const TOOL = path.resolve(U.ROOT, 'tools', 'gemini');
const run = (args, cwd) => new Promise((res, rej) => {
  const p = spawn('node', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const t = setTimeout(() => { p.kill('SIGKILL'); rej(new Error('tool timeout (2h)')); }, 1800000);
  p.on('exit', c => { clearTimeout(t); c === 0 ? res() : rej(new Error(`tool exit ${c}`)); });
  p.on('error', rej);
});

// yunwu na chale (quota/token exhausted, jaisa pehle hua tha) to Gemini
// browser tool se banao — bilkul wahi tareeqa jo images (stage 6) ke liye
// istemal hota hai, sirf 3 prompts ke liye.
async function geminiFallback(dir, styles, videoId) {
  // ASLI BUG (video 4): key hamesha "thumb" tha — HAR video ka thumbnail
  // isi ek key/folder mein jata tha. Doosre video par tool ki apni resume
  // state ("thumb" already 3/3 done, pichle video se bacha hua) dekh kar
  // generation hi skip kar deta tha, aur output/thumb/ khaali reh jata tha
  // (neeche wala rm use clear kar deta hai, lekin state file clear NAHI
  // hoti thi kyunke ghalat naam se clear ho rahi thi — state-thumb.json,
  // jab ke tool asal mein state-normal.json istemal karta hai kyunke
  // run.js MODE "thumb" ko "character" na hone ki wajah se "normal" samajh
  // leta hai). Ab key video-specific hai aur SAHI state file clear hoti hai.
  const key = `${videoId}-thumb`;
  const promptsDir = path.join(TOOL, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const f of fs.readdirSync(promptsDir)) if (f.endsWith('.txt')) fs.rmSync(path.join(promptsDir, f), { force: true });
  fs.writeFileSync(path.join(promptsDir, `${key}.txt`), styles.join('\n'));
  fs.rmSync(path.join(TOOL, 'state-normal.json'), { force: true });
  fs.rmSync(path.join(TOOL, 'output', key), { recursive: true, force: true });

  U.log('   yunwu nahi chala — Gemini browser tool se thumbnail bana raha hun...');
  await run([path.join(TOOL, 'lib', 'run.js'), key], TOOL);

  const outDir = path.join(TOOL, 'output', key);
  if (!fs.existsSync(outDir)) return [];
  const files = fs.readdirSync(outDir)
    .filter(f => /_(\d+)\.(png|jpe?g|webp)$/i.test(f))
    .map(f => ({ f, n: +f.match(/_(\d+)\.[a-z]+$/i)[1] }))
    .sort((a, b) => a.n - b.n);
  const made = [];
  for (const { f, n } of files) {
    const dest = path.join(dir, `thumb_${n}${path.extname(f)}`);
    fs.copyFileSync(path.join(outDir, f), dest);
    made.push(dest);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(path.join(promptsDir, `${key}.txt`), { force: true });
  return made;
}

module.exports = async function (spec, cfg, st) {
  // Thumbnail hi WAHID cheez hai jo API se banti hai — user ka faisla:
  // "thumbnail yunwu - gpt 2 image". Images/stock/avatar kabhi API se nahi.
  //
  // Style seedha niches/werewolf-alpha-romance/niche.md ki "Thumbnails ka
  // andaz" tehqeeq se: single dramatic character close-up (heroine ya Alpha
  // King), warm cinematic lighting (torches/candlelight ya winter blue-silver
  // contrast), MINIMAL/NO text — jaisa is niche ke sab competitor channels
  // karte hain (title khud hook ka kaam karta hai, thumbnail par text nahi).
  // 2026-08-19 user faisla: thumbnail TITLE ke hisaab se banna chahiye —
  // agar title.txt pehle se likha ja chuka hai (main naam/twist decide ho
  // chuka hai), to wahi is prompt ka ASAL source hai, sirf script ka
  // opening nahi. Title na ho to purana script-based fallback chalta hai.
  const script = fs.readFileSync(U.p(spec.id, 'script.txt'), 'utf8');
  const titleFile = U.p(spec.id, 'title.txt');
  const title = fs.existsSync(titleFile) ? fs.readFileSync(titleFile, 'utf8').trim() : '';

  const subjectPrompt = title
    ? `Ek werewolf/Alpha-King paranormal romance audiobook ka thumbnail banana hai.
Video ka TITLE ye hai (ye is video ka ASAL hook/twist hai — thumbnail isi
title ke SPECIFIC lamhe/scene ko dikhaye, koi generic scene nahi):

"${title}"

Neeche kahani ka context bhi hai. Sirf 10-16 lafz mein batao ke thumbnail
mein KAUN sa kirdaar/scene dikhna chahiye — TITLE mein jo specific twist ya
lamha bataya gaya hai wahi (heroine, Alpha King, ya dono ek sath). Ek theek
theek tasveer do (jaise "a handsome, cold Alpha King with ice-pale eyes
looming over a beautiful, kneeling maid in a torch-lit stone hall").
**Alpha King/hero ke liye lafz "handsome" aur heroine ke liye lafz
"beautiful" zaroor shamil karo.** Koi text nahi, koi tashreeh nahi — bas scene.

${script.slice(0, 1200)}`
    : `Ek werewolf/Alpha-King paranormal romance audiobook ka thumbnail banana hai.
Neeche kahani ka shuru hai. Sirf 10-16 lafz mein batao ke thumbnail mein
KAUN sa kirdaar/scene dikhna chahiye — is kahani ke sab se dramatic lamhe se
(heroine, Alpha King, ya dono ek sath). Ek theek theek tasveer do
(jaise "a handsome, cold Alpha King with ice-pale eyes looming over a
beautiful, kneeling maid in a torch-lit stone hall"). **Alpha King/hero ke
liye lafz "handsome" aur heroine ke liye lafz "beautiful" zaroor shamil
karo.** Koi text nahi, koi tashreeh nahi — bas scene.

${script.slice(0, 1200)}`;

  const subject = await AI.chat(cfg.models.prompts, subjectPrompt, { maxTokens: 160, temperature: 0.75 })
    .catch(() => 'a handsome, cold Alpha King looming over a beautiful, low-status heroine in a torch-lit palace hall');

  // 2026-08-19 user faisla: characters HAMESHA bright, clearly-lit chehron ke
  // sath aur 4K/ultra-sharp detail mein hon — atmospheric shadows background/
  // rim-light mein theek hain, lekin heroine/Alpha King ka CHEHRA kabhi
  // andhera/muddy nahi hona chahiye (YouTube thumbnail grid mein chhota dikhta
  // hai, isi liye subject ka bright + sharp hona zaroori hai, thumbnail-click
  // rate ke liye bhi).
  const QUALITY = `4K ultra-detailed, tack-sharp focus on the face, subject's face brightly and clearly lit (never dark or shadowed), high dynamic range, crisp fine detail on skin and eyes.`;
  const styles = [
    // 1 — single dramatic close-up, warm palace lighting (Lily/Alba ka andaz)
    `YouTube thumbnail, photorealistic romance-novel-cover style, 16:9. ${subject}. `
    + `Close-up to mid-torso framing, cinematic dramatic lighting, warm amber/gold `
    + `torchlight and candlelight tones, shallow depth of field, rich skin tones, `
    + `intense emotional expression. ${QUALITY} NO TEXT, no letters, no watermark, no logos.`,
    // 2 — winter/ice contrast (Alpha King ka reusable visual motif)
    `YouTube thumbnail, photorealistic romance-novel-cover style, 16:9. ${subject}. `
    + `Cold winter-blue and silver lighting contrasted with warm skin tones, `
    + `piercing ice-pale eyes, dramatic rim light, misty atmosphere, `
    + `cinematic close-up framing. ${QUALITY} NO TEXT, no letters, no watermark, no logos.`,
    // 3 — saaf cinematic (safe option, thora zyada headroom agar text baad mein add karna ho)
    `Cinematic romance-novel-cover thumbnail, photorealistic, 16:9: ${subject}, `
    + `golden hour or torch-lit warm tones, shallow depth of field, dramatic `
    + `sky or stone-hall background, negative space on one side for a title. `
    + `${QUALITY} NO TEXT, no letters, no watermark, no logos.`,
  ];

  const dir = U.p(spec.id, 'thumbnail');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/prompts.txt`, styles.join('\n\n---\n\n'));

  // Yunwu (gpt-image-2/1) HATA DIYA — har video mein token-quota-exhausted
  // 429 se fail hota tha (kai minute retry mein zaya), phir Gemini fallback
  // par jata tha jo hamesha kaam karta hai. Ab seedha Gemini se banate hain.
  let made = [];
  const existing = [1, 2, 3].map(i => `${dir}/thumb_${i}.png`).filter(fs.existsSync);
  if (existing.length === styles.length) {
    made = existing;
    U.log('   thumbnails pehle se maujood — skip');
  } else {
    try { made = await geminiFallback(dir, styles, spec.id); made.forEach(f => U.ok(path.basename(f))); }
    catch (e) { U.warn(`Gemini thumbnail fail: ${e.message.slice(0, 100)}`); }
  }

  st.meta.thumbnail = made.length;
  U.log(`   cheez: ${String(subject).slice(0, 70)}`);
  if (!made.length) throw new Error('koi thumbnail nahi bani (Gemini fail) — images stage 6 ke liye reference bhi nahi milegi');
  return true;
};
