// ============================================================
//  timeline.json  →  HiddenCut editor project
//     video-templates/public/projects/<id>/project.json
//
//  User ka hukm: is version mein TYPOGRAPHY nahi, SFX nahi —
//  sirf smooth transitions. Awaaz sirf voiceover.
//
//  Assets project ke apne assets/ folder mein copy hote hain, taake
//  editor mein sab kuch relative raaste se khule.
// ============================================================
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const VT = path.resolve(ROOT, '..', 'video-templates');

// LIBRARY ke asli naam — narm transitions ki bari bari
const SOFT = ['fadeSoft', 'dissolveSoft', 'zoomInSoft', 'slideLeftSoft', 'pushLeftSoft',
              'zoomOutSoft', 'slideRightSoft', 'pushRightSoft'];
const MOTION_IMG = ['zoomInSlow', 'zoomOutSlow', 'zoomInMicro', 'zoomOutDrift'];

const id = process.argv[2];
if (!id) { console.error('istemal: node tools/to-hiddencut.js <video-id>'); process.exit(1); }
const work = path.join(ROOT, 'work', id);
const tl = JSON.parse(fs.readFileSync(path.join(work, 'timeline.json'), 'utf8'));

const proj = path.join(VT, 'public', 'projects', id);
const assets = path.join(proj, 'assets');
fs.mkdirSync(assets, { recursive: true });

// jo transitions asal mein library mein hain wahi lagao
let names = [];
try {
  const raw = JSON.parse(fs.readFileSync(path.join(VT, 'src', 'library', 'transitions.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.items || []);
  names = arr.map(x => (typeof x === 'string' ? x : (x.name || x.id))).filter(Boolean);
} catch {}
const soft = SOFT.filter(n => !names.length || names.includes(n));
const pick = (list, i) => list.length ? list[i % list.length] : 'cut';

const copy = (rel) => {
  const src = path.join(work, rel);
  if (!fs.existsSync(src)) return '';
  const base = path.basename(src);
  const dst = path.join(assets, base);
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  return `projects/${id}/assets/${base}`;
};

const shots = [];
let n = 0, missing = 0;
for (const s of tl) {
  if (!s.file) { missing++; continue; }
  const src = copy(s.file);
  if (!src) { missing++; continue; }
  const isVideo = /\.(mp4|mov|mkv|webm)$/i.test(src);
  shots.push({
    type: isVideo ? 'clip' : 'image',
    src,
    transition: pick(soft, n),
    motion: isVideo ? '' : pick(MOTION_IMG, n),
    effect: '',
    fit: 'cover',
    durationInSeconds: +s.dur.toFixed(2),
    volume: 0,                       // clip ki apni awaaz band — sirf voiceover
  });
  n++;
}

const vo = copy('voice/voiceover.mp3');
const out = {
  shots,
  keywords: [],                      // typography nahi (user ka hukm)
  sfx: [],                           // sfx nahi
  overlays: [],
  voiceover: vo,
  voiceVolume: 1,
  music: '',
  musicVolume: 0,
  globalEffect: '',
  canvas: { width: 1920, height: 1080, fps: 30 },
  meta: { name: id.replace(/-/g, ' '), createdAt: new Date().toISOString().slice(0, 10) },
};
fs.writeFileSync(path.join(proj, 'project.json'), JSON.stringify(out, null, 2));
const secs = shots.reduce((a, x) => a + x.durationInSeconds, 0);
console.log(`  ${shots.length} shots | ${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s | ${missing} slots ke asset nahi mile`);
console.log(`  → video-templates/public/projects/${id}/project.json`);
console.log(`  kholne ke liye: cd video-templates && npm run editor   (http://localhost:3333)`);
