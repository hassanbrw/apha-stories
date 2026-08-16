#!/usr/bin/env node
// ============================================================
//  CHECKLIST — video banane se pehle chalao
//
//  Batata hai: kya installed hai, kaunsi API keys hain, browser login
//  hue ya nahi, aur kaunsi niches maujood hain.
//  Koi ❌ ho to video mat banao — pehle wahi theek karo.
// ============================================================
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';
const ok = (m, e = '') => console.log(`  ${G}✓${X} ${m}${e ? D + '  ' + e + X : ''}`);
const bad = (m, fix) => { console.log(`  ${R}✗${X} ${m}`); if (fix) console.log(`      ${Y}→ ${fix}${X}`); fails++; };
const warn = (m, fix) => { console.log(`  ${Y}!${X} ${m}`); if (fix) console.log(`      ${D}${fix}${X}`); };
let fails = 0;

const has = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };

console.log('\n============================================================');
console.log('  FACELESS STUDIO — checklist');
console.log('============================================================\n');

// ---------- 1. programs ----------
console.log('  PROGRAMS');
const node = has('node -v');
node && +node.slice(1).split('.')[0] >= 18 ? ok(`node ${node}`) : bad(`node 18+ chahiye (mila: ${node || 'kuch nahi'})`, 'nodejs.org se install karo');

const ff = has('ffmpeg -version');
ff ? ok('ffmpeg', ff.split('\n')[0].slice(0, 40)) : bad('ffmpeg nahi mila', 'Mac: brew install ffmpeg  |  Windows: winget install Gyan.FFmpeg');

has('ffprobe -version') ? ok('ffprobe') : bad('ffprobe nahi mila', 'ffmpeg ke sath hi aata hai');

const yt = has('yt-dlp --version');
yt ? ok(`yt-dlp ${yt}`) : bad('yt-dlp nahi mila', 'pip3 install -U yt-dlp');

has('python3 --version') ? ok('python3') : warn('python3 nahi mila', 'sirf captions ke liye chahiye (abhi band hain)');

// ---------- 2. node packages ----------
console.log('\n  PACKAGES');
try { require.resolve('playwright'); ok('playwright'); }
catch { bad('playwright nahi mila', 'npm install  (is folder mein)'); }
try {
  const b = require('playwright').chromium.executablePath?.();
  fs.existsSync(path.dirname(b || '')) ? ok('chromium/chrome') : warn('browser shayad install nahi', 'npx playwright install chrome');
} catch { warn('browser check nahi ho saka'); }

// ---------- 3. API keys ----------
console.log('\n  API KEYS  (.env)');
const envF = path.join(ROOT, '.env');
if (!fs.existsSync(envF)) bad('.env nahi hai', 'cp .env.example .env  — phir keys bharo');
else {
  const env = Object.fromEntries(fs.readFileSync(envF, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const need = {
    OPENROUTER_KEY: 'script + image prompts (DeepSeek)',
    AI33_KEY: 'voiceover + word timings',
    YUNWU_KEY: 'stock clip verify (Gemini) + thumbnail',
  };
  for (const [k, why] of Object.entries(need)) {
    const v = env[k];
    if (!v || v.startsWith('<') || v.length < 12) bad(`${k} nahi bhari`, why);
    else ok(k, `${v.slice(0, 8)}…  ${why}`);
  }
}

// ---------- 4. browser logins ----------
console.log('\n  BROWSER LOGIN');
const loggedIn = d => fs.existsSync(path.join(d, 'Default', 'Network', 'Cookies')) && fs.existsSync(path.join(d, 'Local State'));
const gdir = path.join(ROOT, 'browser', 'gemini');
const gProfiles = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter(n => loggedIn(path.join(gdir, n))) : [];
gProfiles.length ? ok(`Gemini login (${gProfiles.length} account)`, 'sahi hai ya nahi — pehli run par pata chalega')
                 : bad('Gemini login nahi hua', 'node setup/gemini-login.js');
loggedIn(path.join(ROOT, 'browser', 'heygen')) ? ok('HeyGen login maujood') : bad('HeyGen login nahi hua', 'node setup/heygen-setup.js');

const avDir = path.join(ROOT, 'avatars');
const avs = fs.existsSync(avDir) ? fs.readdirSync(avDir).filter(f => /\.(png|jpe?g)$/i.test(f)) : [];
avs.length ? ok(`${avs.length} avatar tasveer`, avs.slice(0, 3).join(', '))
           : bad('avatars/ khaali hai', 'avatar ki tasveer avatars/ mein rakho, phir: node setup/heygen-setup.js --photo avatars/<naam>.png --name <Naam>');

// ---------- 5. niches ----------
console.log('\n  NICHES');
const nd = path.join(ROOT, 'niches');
const niches = fs.existsSync(nd) ? fs.readdirSync(nd).filter(f => fs.existsSync(path.join(nd, f, 'niche.md'))) : [];
if (!niches.length) warn('koi niche nahi bani', 'Claude se kaho: "START-HERE.md parho" — wo sawal poochh kar bana dega');
else for (const n of niches) {
  const md = fs.readFileSync(path.join(nd, n, 'niche.md'), 'utf8');
  ok(n, `${(md.match(/^\d+\./gm) || []).length} topics`);
}

// ---------- 6. config ----------
console.log('\n  SETTINGS  (config.json)');
try {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const r = c.ratio, sum = r.avatar + r.images + r.stock;
  sum === 100 ? ok(`ratio  avatar ${r.avatar}% / images ${r.images}% / stock ${r.stock}%`)
              : bad(`ratio ka jama ${sum} hai, 100 hona chahiye`, 'config.json → ratio');
  ok(`character consistency`, c.images.characterConsistency ? `haan — ${Math.round(c.images.characterShare * 100)}% images` : 'band');
  ok(`captions`, c.captions.enabled ? 'on' : 'band');
  ok(`voice id`, c.voice.id);
  ok(`script model`, c.models.script[0]);
  ok(`hook + human pass + stock keywords`, c.claudeWrites?.hook ? 'Claude likhta hai' : 'model likhta hai');
  ok(`rhythm`, 'deterministic — stock shuru se, har 2-3 image ke baad stock');
  ok(`parallel`, 'images + stock + avatar ek sath (SRT bante hi)');
} catch (e) { bad(`config.json parh nahi saka: ${e.message}`); }

// ---------- nateeja ----------
console.log('\n============================================================');
if (fails) {
  console.log(`  ${R}${fails} cheezein baqi hain${X} — inhe theek kiye baghair video mat banao.`);
  process.exit(1);
}
console.log(`  ${G}Sab tayyar hai.${X}  Video banane ke liye:  node run.js --new "<topic>"`);
console.log('============================================================\n');
