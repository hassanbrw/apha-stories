#!/usr/bin/env node
// ============================================================
//  GEMINI LOGIN — browser khol kar chhod deta hai
//
//  Images SIRF Gemini ke browser tool se banti hain (koi paid image API
//  nahi). Us ke liye Google login chahiye — wo sirf tum kar sakte ho.
//
//  Chalao:  node setup/gemini-login.js
//  Browser khulega → Google login karo → "Continue" dabao → tool khul jaye
//  → browser khula chhod do (ya band kar do, login mehfooz rehta hai).
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NAME = process.argv[2] || 'gemini1';
const PROFILE = path.join(ROOT, 'browser', 'gemini', NAME);  // container/profile
const TOOL_URL = process.env.GEMINI_TOOL_URL
  || (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).geminiToolUrl; } catch { return null; } })()
  || 'https://gemini.google.com/share/26b1c2d69587';

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'])
    fs.rmSync(path.join(PROFILE, f), { force: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome', viewport: null, acceptDownloads: true,
    // Ye teen args hatana ZAROORI hai. Playwright inhe by default lagata hai
    // aur phir Chrome macOS Keychain se cookies decrypt nahi kar pata —
    // login hone ke bawajood har baar login page dikhta hai.
    ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check',
           '--disable-blink-features=AutomationControlled'],
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});

  console.log('\n  ------------------------------------------------------');
  console.log('  Browser khul gaya.');
  console.log('  1) Google account se login karo');
  console.log('  2) "Continue" dabao');
  console.log('  3) tool (prompts wala box) khul jaye to kaam ho gaya');
  console.log('  Phir browser band kar do — login mehfooz reh jayega.');
  console.log('  ------------------------------------------------------\n');

  let told = false;
  const t = setInterval(async () => {
    const txt = await page.innerText('body').catch(() => '');
    const inTool = /Generate|prompts/i.test(txt) && !/Sign in/i.test(txt.slice(0, 400));
    if (inTool && !told) { told = true; console.log('  ✅ login ho gaya — tool khul gaya. Browser band kar sakte ho.'); }
  }, 10000);

  await new Promise(res => ctx.on('close', res));
  clearInterval(t);
  console.log('\n  Profile mehfooz: browser/gemini');
  console.log('  Ab checklist chalao:  node setup/check.js\n');
  process.exit(0);
})().catch(e => { console.error(`\n  [X] ${e.message}\n`); process.exit(1); });
