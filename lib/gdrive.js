// ============================================================
//  Google Drive delivery — poora finished-video folder EK ZIP mein
//  bana kar upload karta hai (rclone ke zariye), taake mobile par
//  Drive app mein ek hi file dikhe, bikhri hui files nahi. "gdrive:"
//  remote pehle se rclone config mein maujood hai (dusre pipelines
//  ke liye bhi istemal hota hai) — koi naya OAuth setup nahi chahiye.
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_FOLDER = 'Story Alpha Pipeline';

// work/<id>/ se poora "finished package" (final.mp4, thumbnail, title-
// description.txt) ek <id>.zip mein bana kar gdrive:Story Alpha
// Pipeline/<id>.zip par upload karta hai.
function deliverVideo(id, wd) {
  const items = [
    { src: path.join(wd, 'final.mp4'), name: 'final.mp4' },
    { src: path.join(wd, 'title-description.txt'), name: 'title-description.txt' },
  ];
  const thumbDir = path.join(wd, 'thumbnail');
  if (fs.existsSync(thumbDir)) {
    const first = fs.readdirSync(thumbDir).find(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (first) items.push({ src: path.join(thumbDir, first), name: `thumbnail${path.extname(first)}` });
  }

  // best-effort — jo file mil jaye wo zip mein daalo, jo abhi nahi bani
  // (jaise title-description.txt agar render se pehle hi chal raha ho)
  // usay sirf warn karo, poora delivery is wajah se mat roko.
  const present = items.filter(it => fs.existsSync(it.src));
  const missing = items.filter(it => !fs.existsSync(it.src));
  if (!present.length) throw new Error(`koi bhi file nahi mili: ${items.map(m => m.name).join(', ')}`);

  // staging folder banao taake zip ke andar naam SAAF hon (final.mp4,
  // thumbnail.jpg, title-description.txt) — asal folder ke messy naam
  // (img_xxxxx.jpg wagera) zip mein nahi jaane chahiyen.
  const stageDir = path.join(os.tmpdir(), `deliver-${id}-${Date.now()}`);
  fs.mkdirSync(stageDir, { recursive: true });
  for (const it of present) fs.copyFileSync(it.src, path.join(stageDir, it.name));

  const zipPath = path.join(os.tmpdir(), `${id}.zip`);
  fs.rmSync(zipPath, { force: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });

  const target = `gdrive:${ROOT_FOLDER}/${id}.zip`;
  execFileSync('rclone', ['copyto', zipPath, target], { stdio: 'inherit' });

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  if (missing.length) console.warn(`   [!] ye zip mein shamil nahi (nahi mili): ${missing.map(m => m.name).join(', ')}`);
  return target;
}

module.exports = { deliverVideo, ROOT_FOLDER };
