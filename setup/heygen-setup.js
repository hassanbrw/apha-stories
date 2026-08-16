#!/usr/bin/env node
// ============================================================
//  HEYGEN SETUP — login + naya avatar (tumhari apni tasveer se)
//
//  Bina kisi option ke:   node setup/heygen-setup.js
//     → sirf browser khulta hai, tum login/2FA kar lo.
//
//  Avatar banane ke liye:
//     node setup/heygen-setup.js --photo avatars/farmer.png --name Farmer
//     → my-avatars → New Avatar → Create a virtual character → Upload photo
//       → naam → Create
//
//  Avatar ki VIDEO pipeline banati hai (stages/7-avatar.js) — "Generate"
//  kabhi nahi dabta, sirf "Render Scene" ka preview download hota hai.
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, 'browser', 'heygen');
const UI = path.join(ROOT, 'browser', 'heygen-ui');
const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const PHOTO = arg('photo');
const NAME = arg('name') || 'MyAvatar';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const shot = async (p, n) => { fs.mkdirSync(UI, { recursive: true }); await p.screenshot({ path: path.join(UI, n + '.png') }).catch(() => {}); };

(async () => {
  if (PHOTO && !fs.existsSync(path.resolve(ROOT, PHOTO))) {
    log(`\n  [X] tasveer nahi mili: ${PHOTO}\n      pehle avatar ki image avatars/ mein rakho\n`);
    process.exit(1);
  }
  fs.mkdirSync(PROFILE, { recursive: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'])
    fs.rmSync(path.join(PROFILE, f), { force: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome', viewport: null, acceptDownloads: true,
    // in ke baghair Chrome Keychain se cookies decrypt nahi karta (dekho gemini-login.js)
    ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check',
           '--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // ---------- sirf login ----------
  if (!PHOTO) {
    await page.goto('https://app.heygen.com/avatar/my-avatars', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    log('\n  ------------------------------------------------------');
    log('  Browser khul gaya.');
    log('  1) HeyGen mein login karo (2FA ka 6-digit code bhi)');
    log('  2) "My Avatars" ka safha khul jaye to kaam ho gaya');
    log('  3) browser band kar do — login mehfooz rahega');
    log('');
    log('  Avatar banane ke liye phir ye chalao:');
    log('    node setup/heygen-setup.js --photo avatars/<naam>.png --name <Naam>');
    log('  ------------------------------------------------------\n');
    await new Promise(res => ctx.on('close', res));
    process.exit(0);
  }

  // ---------- naya avatar ----------
  let bad = false;
  try {
    await page.goto('https://app.heygen.com/avatars/create/add-new-avatar-entry?returnTo=%2Favatar%2Fmy-avatars',
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    if (/Continue with Google|Sign in with Apple/i.test(await page.innerText('body').catch(() => ''))) {
      log('\n  [X] HeyGen logged out hai. Pehle bina --photo ke chalao aur login karo.\n');
      bad = true; return;
    }

    // "Upload photo" sirf HOVER par nikalta hai — bina hover ke DOM mein hota hi nahi
    const card = page.locator('text=Create a virtual character').first();
    if (await card.isVisible({ timeout: 15000 }).catch(() => false)) {
      const bb = await card.boundingBox();
      if (bb) { await page.mouse.move(bb.x + bb.width / 2, bb.y - 120); await sleep(1500);
                await page.mouse.move(bb.x + bb.width / 2, bb.y - 100); await sleep(2500); }
    }
    const up = page.getByRole('button', { name: /upload photo/i }).first();
    if (!await up.isVisible({ timeout: 15000 }).catch(() => false)) {
      await shot(page, 'no-upload'); log('  [X] "Upload photo" nahi mila — browser/heygen-ui/no-upload.png dekho'); bad = true; return;
    }

    const full = path.resolve(ROOT, PHOTO);
    let sent = false;
    try {
      const [ch] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), up.click({ timeout: 8000 })]);
      await ch.setFiles(full); sent = true;
    } catch {
      const inp = page.locator('input[type=file][accept*="image"]').last();
      if (await inp.count().catch(() => 0)) { await inp.setInputFiles(full).catch(() => {}); sent = true; }
    }
    if (!sent) { await shot(page, 'no-file'); log('  [X] tasveer upload nahi hui'); bad = true; return; }
    log(`  tasveer bhej di: ${path.basename(full)}`);

    // "Processing avatar..." — is mein waqt lagta hai, jaldi band mat karo
    const t0 = Date.now();
    while (Date.now() - t0 < 8 * 60 * 1000) {
      if (!/Processing avatar/i.test(await page.innerText('body').catch(() => ''))) break;
      await sleep(10000);
    }
    log(`  processing khatam (${Math.round((Date.now() - t0) / 1000)}s)`);
    await sleep(4000);

    // "Name your avatar" → naam → Create
    const nameBox = page.getByPlaceholder(/add a name/i).first();
    if (await nameBox.isVisible({ timeout: 20000 }).catch(() => false)) {
      await nameBox.click({ timeout: 6000 }).catch(() => {});
      await nameBox.fill(NAME, { timeout: 8000 }).catch(() => {});
      await page.keyboard.type(' ').catch(() => {});          // "Create" ko jagane ke liye
      await page.keyboard.press('Backspace').catch(() => {});
      log(`  naam: ${NAME}`);
      await sleep(2000);
    } else { await shot(page, 'no-name'); log('  [!] naam ka khana nahi mila'); }

    const createBtn = page.locator('button:has-text("Create")').last();
    if (await createBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      for (let i = 0; i < 10 && !(await createBtn.isEnabled().catch(() => false)); i++) await sleep(1500);
      await createBtn.click({ timeout: 10000 }).catch(() => {});
      log('  "Create" dabaya');
      await sleep(14000);
    } else { log('  [!] "Create" nahi mila'); bad = true; }

    await shot(page, 'done');
    log(`\n  ✅ avatar ban gaya: "${NAME}"`);
    log(`     video ki spec mein likho:   HeyGenAvatar: ${NAME}`);
    log(`     aur close-up tasveer:        Avatar: ${PHOTO}\n`);
  } catch (e) { log(`  [X] ${e.message}`); bad = true; }
  finally { await ctx.close().catch(() => {}); process.exit(bad ? 1 : 0); }
})();
