// Gemini tool ke output/<id>-<mode>/ ko seconds wale naam par le aata hai.
// (Ek dafa safeId mismatch ki wajah se images tool ke folder mein reh gayi
//  theen — ye script unhein bina dobara banaye jagah par laga deti hai.)
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.resolve(ROOT, '..', 'Bulk-Image', 'team-tool', 'BulkImageTool-Mac');
const safeId = n => n.replace(/\.txt$/i, '').trim().replace(/\s+/g, '').replace(/[^\w.-]/g, '_');

const id = process.argv[2];
const dest = path.join(ROOT, 'work', id, 'images');
fs.mkdirSync(dest, { recursive: true });
const has = tag => ['png','jpg','jpeg','webp'].some(e => fs.existsSync(path.join(dest, `img_${tag}.${e}`)));

let total = 0;
for (const mode of ['character', 'normal']) {
  const mapF = path.join(ROOT, 'work', id, 'prompts', `${mode}.map.json`);
  const srcF = path.join(ROOT, 'work', id, 'prompts', `${mode}.txt`);
  if (!fs.existsSync(mapF)) continue;
  const map = JSON.parse(fs.readFileSync(mapF, 'utf8'));
  const lines = fs.readFileSync(srcF, 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  // wahi pending list jo stage ne bheji thi
  const pending = map.map((m, k) => ({ ...m, prompt: lines[k] })).filter(m => m.prompt && !has(m.tag));

  const outDir = path.join(TOOL, 'output', safeId(`${id}-${mode}`));
  if (!fs.existsSync(outDir)) { console.log(`  ${mode}: output nahi mila`); continue; }
  const files = fs.readdirSync(outDir)
    .filter(f => /_(\d+)\.(png|jpe?g|webp)$/i.test(f))
    .map(f => ({ f, n: +f.match(/_(\d+)\.[a-z]+$/i)[1] }))
    .sort((a, b) => a.n - b.n);

  let n = 0;
  for (const { f, n: seq } of files) {
    const m = pending[seq - 1];
    if (!m) continue;
    fs.copyFileSync(path.join(outDir, f), path.join(dest, `img_${m.tag}${path.extname(f)}`));
    n++;
  }
  console.log(`  ${mode}: ${n}/${files.length} lag gayin (pending the ${pending.length})`);
  total += n;
}

// timeline par chipka do
const tlF = path.join(ROOT, 'work', id, 'timeline.json');
const tl = JSON.parse(fs.readFileSync(tlF, 'utf8'));
let miss = 0;
for (const s of tl.filter(x => x.kind === 'image')) {
  const tag = `${String(Math.floor(s.start)).padStart(5,'0')}_${String(Math.floor(s.end)).padStart(5,'0')}`;
  const hit = ['png','jpg','jpeg','webp'].map(e => `img_${tag}.${e}`).find(f => fs.existsSync(path.join(dest, f)));
  if (hit) s.file = `images/${hit}`; else { s.file = ''; miss++; }
}
fs.writeFileSync(tlF, JSON.stringify(tl, null, 1));
console.log(`  kul ${total} nayi | ab ${fs.readdirSync(dest).filter(f=>/\.(png|jpe?g|webp)$/i.test(f)).length} images | ${miss} slots abhi khaali`);
