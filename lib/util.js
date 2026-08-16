// ============================================================
//  Pipeline ke common kaam: env, config, state, paths, log, ffprobe
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'work');
const VIDEOS = path.join(ROOT, 'videos');

function env() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && m[2].trim()) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

const config = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// ---------- per-video kaam ki jagah ----------
const safeId = s => s.replace(/\.md$/i, '').trim().replace(/\s+/g, '').replace(/[^\w.-]/g, '_');
const workDir = id => path.join(WORK, id);
const p = (id, ...bits) => path.join(workDir(id), ...bits);

// ---------- state (resume ka dil) ----------
function loadState(id) {
  try { return JSON.parse(fs.readFileSync(p(id, 'state.json'), 'utf8')); }
  catch { return { done: {}, meta: {} }; }
}
function saveState(id, st) {
  fs.mkdirSync(workDir(id), { recursive: true });
  fs.writeFileSync(p(id, 'state.json'), JSON.stringify(st, null, 2));
}

// ---------- videos/<naam>.md padho ----------
// MD file insaan ke liye hai; hum us mein se `key: value` lines aur
// "## Topic" ke neeche ka text uthate hain.
function loadVideoSpec(file) {
  const raw = fs.readFileSync(path.join(VIDEOS, file), 'utf8');
  const spec = { file, id: safeId(file), raw };
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*[-*]?\s*([a-zA-Z][\w ]*?)\s*:\s*(.+?)\s*$/);
    if (m) {
      const k = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      if (!(k in spec)) spec[k] = m[2].trim();
    }
  }
  const t = raw.match(/^##\s*Topic\s*\n([\s\S]*?)(?=\n##|\n*$)/mi);
  if (t) spec.topic_text = t[1].trim();
  return spec;
}
const listVideos = () => (fs.existsSync(VIDEOS)
  ? fs.readdirSync(VIDEOS).filter(f => f.toLowerCase().endsWith('.md')).sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }))
  : []);

// ---------- media ----------
function seconds(file) {
  try {
    const o = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
    const n = parseFloat(o);
    return isFinite(n) ? n : 0;
  } catch { return 0; }
}
const has = cmd => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

// ---------- log ----------
const log = (...a) => console.log(...a);
const step = s => console.log(`\n  ── ${s} ${'─'.repeat(Math.max(0, 48 - s.length))}`);
const ok = (...a) => console.log('   ✓', ...a);
const warn = (...a) => console.log('   !', ...a);
const bad = (...a) => console.log('   ✗', ...a);

module.exports = {
  ROOT, WORK, VIDEOS, env, config, safeId, workDir, p,
  loadState, saveState, loadVideoSpec, listVideos, seconds, has,
  log, step, ok, warn, bad,
};
