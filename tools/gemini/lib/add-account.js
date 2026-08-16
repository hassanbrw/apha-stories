// ============================================================
//  ADD NEW ACCOUNT — naya Google account is tool ke liye add karo
//  Browser khulega: TUM khud login karo, phir window band kar do.
//  Password kahin save nahi hota — sirf browser ki apni session.
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const C = require('./common.js');

(async () => {
  console.log('============================================================');
  console.log('  NAYA ACCOUNT ADD KARO');
  console.log('============================================================');

  const S = C.loadSettings();
  fs.mkdirSync(C.PROFILE_DIR, { recursive: true });

  // agla khaali naam
  const existing = C.listToolProfiles();
  let n = existing.length + 1, name;
  do { name = `p${String(n).padStart(2, '0')}-new`; n++; }
  while (fs.existsSync(path.join(C.PROFILE_DIR, name, 'Default', 'Cookies')));

  const dir = path.join(C.PROFILE_DIR, name);
  console.log(`\n  Nayi profile: ${name}`);
  console.log('  1) Khulne wali window mein apne (naye) Google account se login karo');
  console.log('  2) Login hone ke baad bas window BAND kar do');
  console.log('  (Password sirf tum daaloge — ye tool usay save nahi karta)\n');

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    channel: S.browser || 'chrome',
    acceptDownloads: true,
    viewport: null,
    // ZAROORI: Playwright default mein --use-mock-keychain aur --password-store=basic
        // deta hai. In se Chrome asli keychain use nahi karta, purane sign-in tokens
        // decrypt nahi hote aur account SIGN OUT ho jata hai. Isliye ye hata rahe hain.
        ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await new Promise(res => ctx.on('close', res));

  const ok = fs.existsSync(path.join(dir, 'Default', 'Cookies'));
  console.log(ok
    ? `\n  [OK] ${name} add ho gayi. Ab RUN chalao — rotation isay bhi use karegi.`
    : `\n  [!] ${name} mein login nahi mili. Dobara chala kar login kar lo.`);
  process.exit(0);
})();
