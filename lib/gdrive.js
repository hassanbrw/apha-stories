// ============================================================
//  Google Drive delivery — rclone ke zariye, taake finished video
//  (final.mp4 + thumbnail + title/description) user ke mobile par
//  khud-ba-khud pahunch jaye (Drive app se sync). "gdrive:" remote
//  pehle se rclone config mein maujood hai (dusre pipelines ke liye
//  bhi istemal hota hai) — koi naya OAuth setup nahi chahiye.
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_FOLDER = 'Story Alpha Pipeline';

// work/<id>/ se poora "finished package" (final.mp4, thumbnail/, title-
// description.txt) gdrive:Story Alpha Pipeline/<id>/ par upload karta hai.
function deliverVideo(id, wd) {
  const target = `gdrive:${ROOT_FOLDER}/${id}`;
  const items = [
    { src: path.join(wd, 'final.mp4'), name: 'final.mp4' },
    { src: path.join(wd, 'title-description.txt'), name: 'title-description.txt' },
  ];
  const thumbDir = path.join(wd, 'thumbnail');
  if (fs.existsSync(thumbDir)) {
    const first = fs.readdirSync(thumbDir).find(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (first) items.push({ src: path.join(thumbDir, first), name: `thumbnail${path.extname(first)}` });
  }

  // best-effort — jo file mil jaye wo upload karo, jo abhi nahi bani (jaise
  // title-description.txt agar render se pehle hi chal raha ho) usay sirf
  // warn karo, poora upload is wajah se mat roko.
  const present = items.filter(it => fs.existsSync(it.src));
  const missing = items.filter(it => !fs.existsSync(it.src));
  if (!present.length) throw new Error(`koi bhi file nahi mili: ${items.map(m => m.name).join(', ')}`);

  for (const it of present) {
    execFileSync('rclone', ['copyto', it.src, `${target}/${it.name}`], { stdio: 'inherit' });
  }
  if (missing.length) console.warn(`   [!] ye abhi nahi milin, upload nahi hui: ${missing.map(m => m.name).join(', ')}`);
  return target;
}

module.exports = { deliverVideo, ROOT_FOLDER };
