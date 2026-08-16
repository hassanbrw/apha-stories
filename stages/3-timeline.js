// ============================================================
//  STAGE 3 — TIMELINE  (poore pipeline ka dil) — DETERMINISTIC
//
//  Purana tareeqa LLM se har block ko avatar/image/stock deta tha — har baar
//  natija alag, aur timeline dobara banne par slot ke waqt badal jate the
//  (assets orphan → images repeat). Ab koi LLM nahi:
//
//  werewolf-alpha-romance niche: koi avatar nahi, koi stock nahi — sirf
//  images (Ken Burns zoom/pan). Cue-boundaries par slots kaate jate hain:
//       hook zone (<30s): ~2.5s ke tez cuts
//       baad mein:        ~3.5s normal
//
//  Ye function ek hi natija deta hai chahe jitni dafa chalao (deterministic).
// ============================================================
const fs = require('fs');
const U = require('../lib/util.js');

const toSec = t => { const [h, m, r] = t.split(':'); const [s, ms] = r.split(','); return +h * 3600 + +m * 60 + +s + +ms / 1000; };

function parseSrt(txt) {
  const cues = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean);
    const tm = lines.find(l => l.includes('-->'));
    if (!tm) continue;
    const [a, b] = tm.split('-->').map(s => s.trim());
    const text = lines.slice(lines.indexOf(tm) + 1).join(' ').trim();
    if (text) cues.push({ start: toSec(a), end: toSec(b), text });
  }
  return cues;
}

// werewolf-alpha-romance niche: koi avatar nahi, koi stock footage nahi —
// user ki saaf hidayat (competitor channels bhi sab AI-image slideshow hain,
// koi host/avatar nahi). Sirf images, Ken Burns zoom/pan ke sath (cfg.render.zoom),
// character images (C) mode se bikhri hain — kism ke lehaz se wo bhi 'image' hai.
const PATTERN = ['image'];

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const srtFile = U.p(id, 'voice', 'voiceover.srt');
  if (!fs.existsSync(srtFile)) throw new Error('voice/voiceover.srt nahi mila (stage 2 pehle chalao)');

  // ---- LOCK: assets ban chuke hon to timeline dobara na banao (orphan se bachne ko) ----
  const tlFile = U.p(id, 'timeline.json');
  const imgDir = U.p(id, 'images');
  const hasAssets = fs.existsSync(imgDir) && fs.readdirSync(imgDir).some(f => /\.(png|jpe?g|webp)$/i.test(f));
  if (hasAssets && fs.existsSync(tlFile) && !process.env.FORCE_TIMELINE) {
    U.warn('timeline pehle se hai aur images ban chuki hain — dobara nahi banaya');
    U.log('   (zabardasti banani ho to: FORCE_TIMELINE=1 ... lekin phir images bhi dobara banengi)');
    const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
    st.meta.timeline = { slots: tl.length, locked: true };
    return true;
  }

  const cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
  if (!cues.length) throw new Error('SRT khaali hai');
  const total = cues[cues.length - 1].end;

  const H = cfg.hook || {};
  const hookSecs = H.seconds || 30;
  const hookCut = H.cutSeconds || 2.5;
  const S = cfg.shot || {};
  const normImg = ((S.imageMin || 3) + (S.imageMax || 4)) / 2;   // ~3.5
  const normStk = ((S.stockMin || 4) + (S.stockMax || 6)) / 2;   // ~5

  // ---- slots banao: cue-boundaries par kaat kar ----
  const slots = [];
  const push = (kind, a, z, text) => {
    if (z - a < 0.5) return;
    slots.push({ i: slots.length, kind, start: +a.toFixed(2), end: +z.toFixed(2), dur: +(z - a).toFixed(2), text: (text || '').trim().slice(0, 400), file: '' });
  };

  let ci = 0;
  // 1) HOOK ZONE — koi avatar nahi, seedha image rhythm se shuru, bas tez
  //    cuts (hookCut) pehle hookSecs tak, phir normal pacing.
  let patIdx = 0;
  let curStart = cues[0].start;
  let buf = [];
  const targetFor = (kind, start) => {
    if (start < hookSecs) return hookCut;                          // hook mein sab tez
    return kind === 'stock' ? normStk : normImg;
  };
  let kind = PATTERN[patIdx % PATTERN.length];
  let target = targetFor(kind, curStart);

  for (; ci < cues.length; ci++) {
    const c = cues[ci];
    buf.push(c.text);
    const len = c.end - curStart;
    if (len >= target || ci === cues.length - 1) {
      push(kind, curStart, c.end, buf.join(' '));
      curStart = c.end; buf = [];
      patIdx++;
      kind = PATTERN[patIdx % PATTERN.length];
      target = targetFor(kind, curStart);
    }
  }
  if (buf.length && slots.length) {                                // bacha hua narration aakhri slot mein
    const last = slots[slots.length - 1];
    last.end = +total.toFixed(2); last.dur = +(last.end - last.start).toFixed(2);
  }

  fs.writeFileSync(tlFile, JSON.stringify(slots, null, 1));

  // ---- report ----
  const by = k => slots.filter(s => s.kind === k);
  const dur = k => by(k).reduce((a, s) => a + s.dur, 0);
  const pc = x => Math.round(x / total * 100);
  U.ok(`timeline.json — ${slots.length} slots  (deterministic)`);
  U.log(`   image ${by('image').length.toString().padStart(3)}  ${pc(dur('image'))}%`);
  U.log(`   hook: pehla shot ${slots[0].dur}s, phir ${hookCut}s cuts tak ${hookSecs}s`);
  st.meta.timeline = { slots: slots.length, image: by('image').length, seconds: Math.round(total) };
  return true;
};
