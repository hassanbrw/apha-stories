// ============================================================
//  R2 sync helper — rclone ke zariye upload/download
//  ASLI GOTCHA: is R2 token ke paas ListBuckets/CreateBucket permission
//  nahi hai (bucket-scoped token, normal hai) — is liye --s3-no-check-bucket
//  lazmi hai warna rclone copy "create bucket" try kar ke 403 deta hai.
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../lib/util.js');

function rcloneConf() {
  const e = U.env();
  const need = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'];
  const missing = need.filter(k => !e[k]);
  if (missing.length) throw new Error(`.env mein ye R2 keys nahi hain: ${missing.join(', ')}`);
  const confPath = path.join(os.tmpdir(), `rclone-r2-${process.pid}.conf`);
  fs.writeFileSync(confPath,
    `[r2]\ntype = s3\nprovider = Cloudflare\naccess_key_id = ${e.R2_ACCESS_KEY_ID}\n` +
    `secret_access_key = ${e.R2_SECRET_ACCESS_KEY}\nendpoint = ${e.R2_ENDPOINT}\nacl = private\n`);
  return { confPath, bucket: e.R2_BUCKET };
}

function rclone(args) {
  const { confPath } = rcloneConf();
  try {
    execFileSync('rclone', ['--config', confPath, '--s3-no-check-bucket', ...args], { stdio: 'inherit' });
  } finally {
    fs.rmSync(confPath, { force: true });
  }
}

// local file/dir -> r2:bucket/videoId/relPath
function upload(videoId, localPath, relPath) {
  const { bucket } = rcloneConf();
  rclone(['copy', localPath, `r2:${bucket}/${videoId}/${relPath}`]);
}

// r2:bucket/videoId/relPath -> local file/dir
function download(videoId, relPath, localPath) {
  const { bucket } = rcloneConf();
  rclone(['copy', `r2:${bucket}/${videoId}/${relPath}`, localPath]);
}

// r2:bucket/videoId/relPath maujood hai ya nahi (poll-for-marker jaisa istemal ke liye)
function exists(videoId, relPath) {
  const { confPath, bucket } = rcloneConf();
  try {
    const out = execFileSync('rclone', ['--config', confPath, '--s3-no-check-bucket', 'lsf', `r2:${bucket}/${videoId}/${relPath}`], { encoding: 'utf8' }).trim();
    return out.length > 0;
  } catch {
    return false;
  } finally {
    fs.rmSync(confPath, { force: true });
  }
}

// r2:bucket/videoId/relPath (ek file ya poora "folder" prefix — S3 mein asli
// folders nahi hotay, is liye "delete" hi dono ke liye kaam karta hai, "purge"
// nahi) mita do — pehle se khaali/maujood na ho to bhi chup chaap theek hai
function remove(videoId, relPath) {
  const { bucket } = rcloneConf();
  try { rclone(['delete', `r2:${bucket}/${videoId}/${relPath}`]); } catch {}
}

module.exports = { rclone, upload, download, exists, remove, rcloneConf };
