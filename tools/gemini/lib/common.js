// ============================================================
//  Bulk Image Tool — shared engine (Windows + Mac + Linux)
//  Yahan sirf common kaam hain: paths, profiles, zip, tool control.
// ============================================================
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');   // tool folder ki jarh (lib se ek level upar)
const PROMPT_DIR = path.join(ROOT, 'prompts');
const REF_DIR = path.join(ROOT, 'reference');
const OUT_DIR = path.join(ROOT, 'output');
const ZIP_DIR = path.join(ROOT, 'downloads');
// Profiles ab studio ke sanjhe folder mein: <studio>/browser/gemini
// (setup/gemini-login.js wahi banata hai — do jagah login karne ki zaroorat nahi)
const PROFILE_DIR = path.join(ROOT, '..', '..', 'browser', 'gemini');
const SETTINGS = path.join(ROOT, 'settings.json');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const natSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const IMG_RE = /\.(png|jpe?g|webp)$/i;

// ---------- settings ----------
function loadSettings() {
  const def = {
    toolUrl: 'https://gemini.google.com/',
    imagesPerProfile: 1000,
    batchSize: { normal: 50, character: 25 },
    browser: 'chrome',
  };
  try { return { ...def, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) }; } catch { return def; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }

// ---------- state (resume) ----------
function statePath(mode) { return path.join(ROOT, `state-${mode}.json`); }
function loadState(mode) {
  try { return JSON.parse(fs.readFileSync(statePath(mode), 'utf8')); }
  catch { return { batchNo: 0, used: {}, progress: {} }; }
}
function saveState(mode, s) { fs.writeFileSync(statePath(mode), JSON.stringify(s, null, 2)); }

// ---------- user ki asli Chrome ka user-data folder ----------
function chromeUserDataRoot() {
  // settings mein hath se diya ho to wahi (Chrome kisi aur jagah install ho)
  const fromSettings = (loadSettings().chromeUserDataDir || '').trim();
  if (fromSettings && fs.existsSync(fromSettings)) return fromSettings;

  const home = os.homedir();
  if (IS_WIN) {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'Google', 'Chrome', 'User Data');
  }
  if (IS_MAC) return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(home, '.config', 'google-chrome');
}

// user ki Chrome mein kitni profiles hain (naam + email)
function listChromeProfiles() {
  const root = chromeUserDataRoot();
  const ls = path.join(root, 'Local State');
  if (!fs.existsSync(ls)) return [];
  let info = {};
  try { info = JSON.parse(fs.readFileSync(ls, 'utf8')).profile?.info_cache || {}; } catch {}

  // DONO cheezein milao: folder par jo mojood hai + Local State ka naam/email.
  // (Sirf Local State par bharosa karne se woh profiles chhoot jati hain jo us list
  //  mein na hon — is liye asli folders hi buniyad hain.)
  const onDisk = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/i.test(d.name)))
    .map(d => d.name);

  // Local State mein aisi entry ho jiska folder maujood ho lekin naam scan se na mila (ehtiyatan)
  for (const folder of Object.keys(info)) {
    if (!onDisk.includes(folder) && fs.existsSync(path.join(root, folder))) onDisk.push(folder);
  }

  return onDisk
    .map(folder => ({
      folder,
      name: info[folder]?.name || folder,
      email: info[folder]?.user_name || '',
    }))
    .sort((a, b) => natSort(a.folder, b.folder));
}

function chromeRunning() {
  try {
    if (IS_WIN) return execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8' }).toLowerCase().includes('chrome.exe');
    return execSync('pgrep -f "Google Chrome.app/Contents/MacOS/Google Chrome" || pgrep -x chrome || true', { encoding: 'utf8' }).trim().length > 0;
  } catch { return false; }
}

// Chrome ka default (bina settings override) data folder
function defaultChromeRoot() {
  const home = os.homedir();
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (IS_MAC) return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(home, '.config', 'google-chrome');
}

// Sirf tab masla hai jab Chrome USI data folder par chal rahi ho jo hum kholna chahte hain.
// (Kisi doosre folder par chalti Chrome se koi takraar nahi hoti.)
function chromeRunningForRoot(root) {
  if (path.resolve(root) === path.resolve(defaultChromeRoot())) return chromeRunning();
  try {
    const out = IS_WIN
      ? execSync('powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Select-Object -ExpandProperty CommandLine"', { encoding: 'utf8' })
      : execSync('ps -ww -A -o command 2>/dev/null || true', { encoding: 'utf8' });
    // sirf chrome wali lines — warna doosre commands (jinme ye path likha ho) galat alarm dete hain
    return out.split('\n').filter(l => /chrome/i.test(l)).some(l => l.includes(root));
  } catch { return false; }
}

// bhaari cache — copy karne ki zaroorat nahi
const COPY_EXCLUDES = [
  'Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache',
  'CacheStorage', 'ScriptCache', 'blob_storage', 'File System',
  'component_crx_cache', 'extensions_crx_cache', 'Crashpad', 'BrowserMetrics',
];

// asli profile ki COPY banao (asli Chrome ko haath nahi lagta)
function copyProfile(srcFolder, dstDir) {
  const src = path.join(chromeUserDataRoot(), srcFolder);
  const dstDefault = path.join(dstDir, 'Default');
  fs.mkdirSync(dstDefault, { recursive: true });

  if (IS_WIN) {
    const xd = COPY_EXCLUDES.flatMap(e => ['/XD', e]);
    // robocopy 1 = kuch copy hua, 0 = kuch naya nahi — dono theek hain
    try {
      execFileSync('robocopy', [src, dstDefault, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1', ...xd], { stdio: 'ignore' });
    } catch (e) {
      if (!e.status || e.status > 7) throw new Error(`robocopy fail (code ${e.status})`);
    }
  } else {
    const ex = COPY_EXCLUDES.flatMap(e => ['--exclude', e]);
    execFileSync('rsync', ['-a', '--delete', ...ex, src + '/', dstDefault + '/'], { stdio: 'ignore' });
  }

  // ---- COOKIES KI CHAABI ----
  // Chrome cookies ko encrypt karta hai. Us encryption ki chaabi profile folder ke
  // ANDAR nahi, "User Data\Local State" mein hoti hai (Windows par DPAPI/App-Bound).
  // Ye file copy na ki jaye to copied cookies decrypt nahi hoti aur account
  // LOGGED OUT dikhta hai. Sirf os_crypt hissa lete hain (profile list nahi,
  // warna Chrome doosri profiles dhoondne lagti hai).
  try {
    const srcLS = path.join(chromeUserDataRoot(), 'Local State');
    const dstLS = path.join(dstDir, 'Local State');
    if (fs.existsSync(srcLS)) {
      let done = false;
      try {
        const j = JSON.parse(fs.readFileSync(srcLS, 'utf8'));
        if (j.os_crypt) {
          fs.writeFileSync(dstLS, JSON.stringify({ os_crypt: j.os_crypt }));
          done = true;
        }
      } catch {}
      if (!done) fs.copyFileSync(srcLS, dstLS);   // parse na ho to poori file
    }
  } catch (e) {
    console.log(`    (chaabi copy nahi hui: ${e.message} — login maangi ja sakti hai)`);
  }

  // purane lock nishan hata do warna Chrome "already in use" kehti hai
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    fs.rmSync(path.join(dstDir, f), { force: true });
  }
}

// nayi Chrome cookies "Default/Network/Cookies" mein hoti hain, purani "Default/Cookies"
function profileHasLogin(dir) {
  return fs.existsSync(path.join(dir, 'Default', 'Network', 'Cookies'))
      || fs.existsSync(path.join(dir, 'Default', 'Cookies'));
}
// chaabi maujood hai? (ye na ho to login logged-out dikhegi)
function profileHasKey(dir) {
  return fs.existsSync(path.join(dir, 'Local State'));
}

// tool ke istemal ke liye tayyar profiles
function listToolProfiles() {
  if (!fs.existsSync(PROFILE_DIR)) return [];
  return fs.readdirSync(PROFILE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort(natSort);
}
function clearLocks(profileName) {
  const dir = path.join(PROFILE_DIR, profileName);
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

// ---------- zip (Windows par unzip nahi hota, PowerShell use karo) ----------
function unzipToTemp(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulkimg-'));
  if (IS_WIN) {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`],
      { stdio: 'ignore' });
  } else {
    execFileSync('unzip', ['-o', '-j', '-q', zipPath, '-d', tmp]);
  }
  // Windows par folder ke andar folder ban sakta hai — sab images dhoond lo
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (IMG_RE.test(e.name)) found.push(p);
    }
  })(tmp);
  found.sort((a, b) => natSort(path.basename(a), path.basename(b)));
  return { tmp, files: found };
}

// asli file type magic bytes se (tool sab ko .png naam deta hai chahe JPEG ho)
function realExt(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, 0);
  fs.closeSync(fd);
  if (b[0] === 0xFF && b[1] === 0xD8) return '.jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return '.png';
  if (b[0] === 0x52 && b[1] === 0x49) return '.webp';
  return '.jpg';
}

// ---------- prompts ----------
// prompts/ ki har .txt = ek video.  "video 1.txt" → id "video1"
function safeId(name) {
  return name.replace(/\.txt$/i, '').trim().replace(/\s+/g, '').replace(/[^\w.-]/g, '_');
}
function loadVideos() {
  if (!fs.existsSync(PROMPT_DIR)) return [];
  return fs.readdirSync(PROMPT_DIR)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .sort(natSort)
    .map(f => ({
      file: f,
      key: f.replace(/\.txt$/i, ''),
      id: safeId(f),
      prompts: fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8')
        .split('\n')
        .map(s => s.trim().replace(/^["']|["']$/g, '').trim())
        .filter(s => s && !s.startsWith('#')),
    }))
    .filter(v => v.prompts.length);
}

// ---------- reference images ----------
// pehle us video ka apna folder dekho: reference/<video naam>/character.jpg
// warna common: reference/character/  (pehli image)
function firstImageIn(dir) {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter(x => IMG_RE.test(x)).sort(natSort)[0];
  return f ? path.join(dir, f) : null;
}
function sideText(imgPath) {
  if (!imgPath) return '';
  const t = imgPath.replace(IMG_RE, '.txt');
  try { return fs.readFileSync(t, 'utf8').trim(); } catch { return ''; }
}
function resolveRefs(videoKey) {
  const perVideo = path.join(REF_DIR, videoKey);
  const pick = kind => {
    // reference/<video>/character.jpg  ya  reference/<video>/character/ ke andar
    if (fs.existsSync(perVideo)) {
      const direct = fs.readdirSync(perVideo)
        .filter(f => IMG_RE.test(f) && f.toLowerCase().startsWith(kind))
        .sort(natSort)[0];
      if (direct) return path.join(perVideo, direct);
      const sub = firstImageIn(path.join(perVideo, kind));
      if (sub) return sub;
    }
    return firstImageIn(path.join(REF_DIR, kind));
  };
  const character = pick('character');
  const style = pick('style');
  return {
    character, style,
    characterText: sideText(character),
    styleText: sideText(style),
  };
}

// ---------- tool control ----------
async function findToolFrame(ctx) {
  for (const pg of ctx.pages()) {
    if (pg.isClosed()) continue;
    for (const f of pg.frames()) { try { if (await f.$('#prompts')) return f; } catch {} }
  }
  return null;
}

async function waitForTool(ctx, page, toolUrl, label) {
  console.log(`  browser khol raha hun: ${toolUrl}`);
  try { await page.goto(toolUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
  let frame = await findToolFrame(ctx);
  if (frame) return frame;

  console.log('  ------------------------------------------------');
  console.log(`  ${label}: agar login maange to KHUD login karo,`);
  console.log('  phir "Continue" dabao aur tool khulne do. Baaki khud ho jayega.');
  console.log('  ------------------------------------------------');

  const start = Date.now(); let last = 0;
  while (Date.now() - start < 15 * 60 * 1000) {
    if (ctx.pages().every(p => p.isClosed())) return null;
    frame = await findToolFrame(ctx);
    if (frame) return frame;
    if (Date.now() - last > 10000) {
      for (const pg of ctx.pages()) {
        if (pg.isClosed()) continue;
        for (const nm of [/Continue/i, /Open in Gemini/i]) {
          try {
            const b = pg.getByRole('button', { name: nm });
            if (await b.first().isVisible({ timeout: 500 }).catch(() => false)) await b.first().click().catch(() => {});
          } catch {}
        }
      }
      last = Date.now();
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  return null;
}

// toggles "sr-only" hain — pehle label click, warna JS + change event
async function setToggle(frame, id, on) {
  const read = () => frame.evaluate(i => document.querySelector(i)?.checked, `#${id}`);
  if (await read() === on) return true;
  try {
    const lbl = frame.locator(`label:has(#${id})`);
    if (await lbl.count()) await lbl.first().click({ timeout: 3000 });
  } catch {}
  if (await read() === on) return true;
  await frame.evaluate(({ i, v }) => {
    const el = document.querySelector(i);
    if (!el) return;
    el.checked = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { i: `#${id}`, v: on });
  return (await read()) === on;
}

async function readSettingsFromPage(frame) {
  return frame.evaluate(() => ({
    aspect: document.querySelector('#aspectRatio')?.value,
    cc: !!document.querySelector('#ccToggle')?.checked,
    sc: !!document.querySelector('#scToggle')?.checked,
    ccFile: document.querySelector('#ccImage')?.files?.[0]?.name || '',
    scFile: document.querySelector('#scImage')?.files?.[0]?.name || '',
  }));
}

// 16:9 hamesha lock. character mode mein CC on + image. style ref mile to SC on.
async function applySettings(frame, { useCharacter, refs }) {
  await frame.selectOption('#aspectRatio', 'landscape');   // 16:9 LOCKED

  if (useCharacter && refs.character) {
    if (!await setToggle(frame, 'ccToggle', true)) throw new Error('Character Consistency on nahi hui');
    if (refs.characterText) await frame.fill('#ccText', refs.characterText, { timeout: 30000 }).catch(() => {});
    await frame.setInputFiles('#ccImage', refs.character);
  } else {
    await setToggle(frame, 'ccToggle', false);
  }

  if (refs.style) {
    if (!await setToggle(frame, 'scToggle', true)) throw new Error('Style Reference on nahi hui');
    if (refs.styleText) await frame.fill('#scText', refs.styleText, { timeout: 30000 }).catch(() => {});
    await frame.setInputFiles('#scImage', refs.style);
  } else {
    await setToggle(frame, 'scToggle', false);
  }
}

// ek generate + download. return { made, zipPath }
async function generateBatch(toolPage, frame, prompts, zipName, tag, perPromptMs) {
  const genTimeout = Math.max(30 * 60 * 1000, prompts.length * perPromptMs);

  await frame.waitForFunction(
    () => { const b = document.querySelector('#generate-btn'); return b && !b.disabled; },
    null, { timeout: genTimeout }
  );
  await frame.fill('#prompts', prompts.join('\n'), { timeout: 60000 });
  console.log(`  > ${tag}: ${prompts.length} prompts bhej diye... (max ~${Math.round(genTimeout / 60000)} min)`);
  await frame.click('#generate-btn');

  await frame.waitForFunction(() => document.querySelector('#generate-btn')?.disabled === true, null, { timeout: 60000 }).catch(() => {});
  // NOTE: Playwright = waitForFunction(fn, arg, options). Options TEESRI jagah hone
  // chahiye warna default 30s lagta hai aur kaam beech mein tootta hai.
  await frame.waitForFunction(() => document.querySelector('#generate-btn')?.disabled === false, null, { timeout: genTimeout });

  const made = await frame.evaluate(() => document.querySelectorAll('.image-card-group img').length).catch(() => null);
  console.log(`    ${made ?? '?'}/${prompts.length} images bani`);

  const canDl = await frame.evaluate(() => { const b = document.querySelector('#download-all-btn'); return b && !b.disabled; });
  if (!canDl) return { made: 0, zipPath: null };

  fs.mkdirSync(ZIP_DIR, { recursive: true });
  const [dl] = await Promise.all([
    toolPage.waitForEvent('download', { timeout: Math.max(120000, prompts.length * 4000) }),
    frame.click('#download-all-btn'),
  ]);
  const zipPath = path.join(ZIP_DIR, `${zipName}.zip`);
  await dl.saveAs(zipPath);
  return { made: made ?? prompts.length, zipPath };
}

// zip → output/<id>/<id>_N.jpg ; count match na ho to andaze se rename NAHI
function saveRenamed(zipPath, video, startSeq, expected, batchNo) {
  const destDir = path.join(OUT_DIR, video.id);
  fs.mkdirSync(destDir, { recursive: true });
  let tmp, files;
  try { ({ tmp, files } = unzipToTemp(zipPath)); }
  catch (e) { console.log(`    zip khul nahi saka: ${e.message}`); return { ok: false, got: 0 }; }

  if (files.length !== expected) {
    const q = path.join(destDir, `_check_batch_${String(batchNo).padStart(3, '0')}`);
    fs.mkdirSync(q, { recursive: true });
    for (const f of files) fs.copyFileSync(f, path.join(q, path.basename(f)));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`    ! ${files.length}/${expected} mili — asli naamon ke sath ${path.basename(q)} mein rakh di (naam galat na ho jayen).`);
    return { ok: false, got: files.length };
  }

  files.forEach((f, i) => fs.copyFileSync(f, path.join(destDir, `${video.id}_${startSeq + i}${realExt(f)}`)));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`    saved: output/${video.id}/${video.id}_${startSeq}...${startSeq + files.length - 1}`);
  return { ok: true, got: files.length };
}

module.exports = {
  ROOT, PROMPT_DIR, REF_DIR, OUT_DIR, ZIP_DIR, PROFILE_DIR,
  IS_WIN, IS_MAC, natSort,
  loadSettings, saveSettings, loadState, saveState,
  chromeUserDataRoot, defaultChromeRoot, listChromeProfiles, chromeRunning, chromeRunningForRoot, copyProfile,
  listToolProfiles, clearLocks, profileHasLogin, profileHasKey,
  unzipToTemp, realExt, safeId, loadVideos, resolveRefs, firstImageIn,
  findToolFrame, waitForTool, setToggle, readSettingsFromPage, applySettings,
  generateBatch, saveRenamed,
};
