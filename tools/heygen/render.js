// ============================================================
//  HeyGen — audio upload -> Avatar III -> RENDER -> preview mp4 download
//
//  ⚠ "Generate" ko KABHI nahi dabata. User ne bataya ke Render ke baad
//    preview ka mp4 URL DOM mein aa jata hai:
//        div.css-1pbmfcm > video[src="https://heygen-resources-prod...mp4?X-Amz-..."]
//    Wahi URL seedha download kar lete hain — credit kharch nahi hota.
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = path.join(ROOT, 'browser', 'heygen');
const UI = path.join(ROOT, 'browser', 'heygen-ui');
const OUT = path.join(ROOT, 'browser', 'heygen-out');

// User ka bataya raasta (30-07-2026): seedha create-v4/draft link kholne par
// HeyGen 2FA maang leta hai. Is liye pehle apne avatar ke page par jao aur
// wahan se "Build scene-by-scene" daba kar editor mein daakhil ho.
const AVATAR_ID = process.env.HEYGEN_AVATAR || '8b89107b3ba84e46be7884c6703e008a';
const AVATAR_NAME = process.env.HEYGEN_AVATAR_NAME || 'Naveed';

const AUDIO = process.env.HEYGEN_AUDIO || '';
// Pipeline se chalte waqt browser khula chhodna nahi hai (warna sab atak jata hai)
// aur video seedha ek maloom jagah par chahiye.
const OUT_FILE = process.env.HEYGEN_OUT || '';
const AUTO = !!OUT_FILE || process.env.HEYGEN_AUTOCLOSE === '1';

const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  fs.mkdirSync(UI, { recursive: true });
  await page.screenshot({ path: path.join(UI, name + '.png') }).catch(() => {});
}

// page par jo click ho sakta hai / file inputs — masla aane par yehi kaam aata hai
async function dumpControls(page, name) {
  const info = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input,button,[role=button],select,video,[class*="upload"]').forEach(el => {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (el.tagName !== 'INPUT' && r.width < 15) return;
      out.push([
        el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : ''),
        el.getAttribute('accept') ? 'accept=' + el.getAttribute('accept') : '',
        el.className ? 'cls=' + String(el.className).slice(0, 45) : '',
        t ? `"${t}"` : '',
        el.tagName === 'VIDEO' ? 'src=' + String(el.src || '').slice(0, 60) : '',
      ].filter(Boolean).join('  '));
    });
    return out;
  }).catch(() => []);
  fs.mkdirSync(UI, { recursive: true });
  fs.writeFileSync(path.join(UI, name + '.txt'), info.join('\n') + '\n');
  return info;
}

// asli kaam: preview video ka URL nikalo
async function grabVideoUrl(page) {
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll('video')];
    for (const v of vids) {
      const s = v.currentSrc || v.src || '';
      if (/heygen-resources|amazonaws\.com/.test(s) && /\.mp4/.test(s)) return s;
    }
    // kabhi <source> ke andar hota hai
    for (const s of document.querySelectorAll('video source')) {
      const u = s.src || '';
      if (/heygen-resources|amazonaws\.com/.test(u) && /\.mp4/.test(u)) return u;
    }
    return null;
  }).catch(() => null);
}

let failed = false;
(async () => {
  if (!AUDIO || !fs.existsSync(AUDIO)) {
    log(`[X] audio file nahi mili: ${AUDIO}\n    HEYGEN_AUDIO=<path to mp3> de kar chalao.`);
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome', acceptDownloads: true, viewport: null,
    // Playwright default mein --use-mock-keychain aur --password-store=basic
    // deta hai. Un ke sath Chrome macOS Keychain se cookies decrypt nahi kar
    // pata — profile logged-in hote hue bhi login page dikhata hai (pakra gaya).
    ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = ctx.pages()[0] || await ctx.newPage();

    // ---- 0. my-avatars -> Naveed -> look -> "Build scene-by-scene" ----
    //  Seedha create-v4/draft link 2FA maang leta hai. User ne yehi raasta
    //  bataya, aur yehi chalta hai.
    log('  my-avatars khol raha hun...');
    await page.goto('https://app.heygen.com/avatar/my-avatars', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    if (/Continue with Google|Sign in with Apple/i.test(await page.innerText('body').catch(() => ''))) {
      log('\n  [X] HeyGen logged out hai. Ek dafa khud login karo:  node lib/login.js');
      failed = true; return;
    }

    const card = page.getByText(AVATAR_NAME, { exact: true }).first();
    if (!await card.isVisible({ timeout: 15000 }).catch(() => false)) {
      await shot(page, '0-no-card');
      log(`  [X] avatar "${AVATAR_NAME}" list mein nahi mila — ui/0-no-card.png`);
      failed = true; return;
    }
    await card.click({ timeout: 10000 });
    await sleep(8000);
    log(`  avatar khula: ${AVATAR_NAME}`);

    // Look card = page ki SAB SE BARI tasveer. (Naam/class se dhoondne par
    // sidebar ka HeyGen logo milta tha aur click Home le jata tha.)
    const box = await page.evaluate(() => {
      let best = null, area = 0;
      for (const el of document.querySelectorAll('img,video')) {
        const r = el.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > area && r.width > 200 && r.height > 150) { area = a; best = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
      }
      return best;
    });
    if (!box) { await shot(page, '0-no-look'); log('  [X] look card nahi mila'); failed = true; return; }
    await page.mouse.click(box.x, box.y);
    await sleep(5000);

    // modal: "Use in video" -> menu -> "Build scene-by-scene"
    let entered = false;
    const uiv = page.locator('button:has-text("Use in video")').first();
    if (await uiv.isVisible({ timeout: 10000 }).catch(() => false)) {
      await uiv.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
      for (const sel of ['[role=menuitem]:has-text("Build scene-by-scene")',
                         'text="Build scene-by-scene"',
                         'button:has-text("Build scene-by-scene")']) {
        const b2 = page.locator(sel).first();
        if (await b2.isVisible({ timeout: 4000 }).catch(() => false)) {
          await b2.click({ timeout: 8000 }).catch(() => {});
          entered = true; break;
        }
      }
    }
    if (!entered) {
      await shot(page, '0b-no-menu'); await dumpControls(page, '0b-no-menu');
      log('  [X] "Build scene-by-scene" nahi mila — ui/0b-no-menu.png dekho');
      failed = true; return;
    }
    log('  "Build scene-by-scene" -> editor');
    await sleep(18000);                       // editor bhaari hai
    await shot(page, '1-loaded');
    await dumpControls(page, '1-loaded');
    log(`  URL: ${page.url().slice(0, 70)}`);

    // ---- 1. AUDIO UPLOAD ----
    //  Page ke chhupe hue file inputs CSV/Excel ke hain
    //  (accept=.xlsx,.xls,.csv,.txt) — un mein mp3 daalne se kuch nahi hota,
    //  bas chup chaap gum ho jati hai aur scene par "No script" reh jata hai.
    //  Sirf "Upload audio" button + filechooser hi sahi raasta hai.
    log('\n  [1] audio upload...');
    const audioAttached = async () => page.evaluate(() => {
      const t = document.body.innerText;
      return /Recorded voice/i.test(t) || /\.mp3/i.test(t);
    }).catch(() => false);

    //  "Upload audio" dabane par page mein ek NAYA hidden input banta hai
    //  jiska accept="audio/wav,audio/mpeg,..." hota hai. Native file picker
    //  nahi khulta. Baqi do inputs CSV/Excel ke hain — un mein mp3 daalne se
    //  kuch nahi hota aur scene par "No script" reh jata hai (pakra gaya).
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const upBtn = page.getByRole('button', { name: /upload audio/i }).first();
      if (!await upBtn.isVisible({ timeout: 12000 }).catch(() => false)) {
        log(`      koshish ${attempt}: "Upload audio" nahi dikha`); await sleep(4000); continue;
      }
      await upBtn.click({ timeout: 8000 }).catch(() => {});
      await sleep(3500);

      const audioInput = page.locator('input[type=file][accept*="audio"]').last();
      if (!await audioInput.count().catch(() => 0)) {
        log(`      koshish ${attempt}: audio wala input nahi bana`);
        await page.keyboard.press('Escape').catch(() => {}); await sleep(3000); continue;
      }
      await audioInput.setInputFiles(AUDIO).catch(e => log(`      setFiles: ${e.message.slice(0, 50)}`));
      log(`      koshish ${attempt}: audio de di (${(fs.statSync(AUDIO).size / 1048576).toFixed(1)} MB)`);

      // lagne mein waqt lagta hai (bari file upload + process)
      for (let i = 0; i < 36 && !done; i++) { await sleep(5000); done = await audioAttached(); }
      log(`      audio lagi: ${done ? 'HAAN' : 'NAHI'}`);
    }

    // Panel ko CONFIRM wale button se band karo. "Close" upload ko cancel kar
    // deta hai — audio lag jaane ke baad bhi scene par "No script" reh jata
    // hai (pakra gaya: log mein "audio lagi: HAAN" tha, phir bhi No script).
    await dumpControls(page, '2a-panel');

    // "Confirm Audio" modal aata hai: [Back] [Add audio].
    // SIRF "Add audio" — pehle generic has-text("Add") laga rakha tha jo
    // "Add scene" par chala jata tha, isi liye scene khali reh jata tha
    // aur "No script" likha aata tha (pakra gaya).
    await page.waitForFunction(() => /Confirm Audio/i.test(document.body.innerText),
      null, { timeout: 60000 }).catch(() => {});
    const addBtn = page.getByRole('button', { name: /^add audio$/i }).first();
    if (await addBtn.isVisible({ timeout: 20000 }).catch(() => false)) {
      await addBtn.click({ timeout: 10000 }).catch(() => {});
      log('      "Add audio" dabaya');
      await sleep(8000);
    } else {
      await shot(page, '2a-no-add'); await dumpControls(page, '2a-no-add');
      log('  [X] "Add audio" button nahi mila — ui/2a-no-add.png dekho');
      failed = true; return;
    }

    await shot(page, '2-audio');
    await dumpControls(page, '2-audio');

    // Bina audio ke render karna bekar hai — scene par "No script" reh jata hai
    if (!await audioAttached()) {
      log('  [X] audio scene par nahi lagi ("No script") — render nahi kar raha.');
      failed = true; return;
    }

    // ---- 2. AVATAR III (lip sync) ----
    //  Avatar IV "generic motion" hai — uploaded audio ke sath hont theek nahi
    //  chalte. Avatar III hi "Applies lip sync" karta hai.
    //  Dropdown kabhi pehli click par nahi khulta — 3 dafa koshish, aur baad
    //  mein button ka label parh kar tasdeeq karte hain.
    log('\n  [2] Motion Engine = Avatar III...');
    const engineLabel = async () => (await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.innerText || '').trim();
        if (/^Avatar (III|IV|V)$/.test(t)) return t;
      }
      return '';
    }).catch(() => ''));

    let cur = await engineLabel();
    log(`      abhi laga hua: ${cur || '?'}`);
    for (let attempt = 1; attempt <= 3 && cur !== 'Avatar III'; attempt++) {
      const dd = page.locator(`button:has-text("${cur || 'Avatar IV'}")`).first();
      if (!await dd.isVisible({ timeout: 8000 }).catch(() => false)) { await sleep(3000); cur = await engineLabel(); continue; }
      await dd.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);

      // option tabhi maujood hai jab dropdown wakai khula ho
      const opened = await page.evaluate(() => /Applies lip sync/i.test(document.body.innerText)).catch(() => false);
      if (!opened) { log(`      koshish ${attempt}: dropdown nahi khula`); await page.keyboard.press('Escape').catch(() => {}); await sleep(1500); cur = await engineLabel(); continue; }

      let picked = false;
      for (const sel of ['[role=option]:has-text("Avatar III")', 'li:has-text("Avatar III")',
                         'div:has-text("Applies lip sync")', 'text="Avatar III"']) {
        const opt = page.locator(sel).last();
        if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
          await opt.click({ timeout: 6000 }).catch(() => {});
          picked = true; break;
        }
      }
      await sleep(3000);
      cur = await engineLabel();
      log(`      koshish ${attempt}: ${picked ? 'click kiya' : 'option nahi mila'} → ab "${cur}"`);
    }
    if (cur !== 'Avatar III') {
      await shot(page, '2b-engine-open'); await dumpControls(page, '2b-engine-open');
      log('  [X] Avatar III nahi lag saka — Avatar IV par render karne se hont theek nahi chalenge.');
      failed = true; return;
    }
    log('      ✅ Avatar III laga');
    await sleep(2000);

    // ---- 3. RENDER (Generate NAHI) ----
    log('\n  [3] Render dabata hun (Generate ko chhuunga bhi nahi)...');
    let clicked = false;
    for (const label of ['Render Scene', 'Render', 'Preview']) {
      const b = page.locator(`button:has-text("${label}")`).first();
      if (await b.isVisible({ timeout: 8000 }).catch(() => false)) {
        await b.click({ timeout: 8000 }).catch(() => {});
        log(`      "${label}" click kiya`);
        clicked = true;
        break;
      }
    }
    if (!clicked) log('      [!] Render button nahi mila — ui/2-audio.txt dekho');

    // ---- 4. "Scene rendered" ka intezaar, phir video URL ----
    const RENDER_WAIT = +(process.env.HEYGEN_WAIT_MIN || 25);
    log(`\n  [4] render hone ka intezaar (max ${RENDER_WAIT} min)...`);
    let url = null;
    const t0 = Date.now();
    while (Date.now() - t0 < RENDER_WAIT * 60 * 1000) {
      const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
      const rendered = /scene rendered/i.test(txt);
      url = await grabVideoUrl(page);
      if (url) { log(`      video URL mil gaya (${Math.round((Date.now() - t0) / 1000)}s)`); break; }
      if (rendered) log('      "Scene rendered" dikha, URL dhoond raha hun...');
      await sleep(10000);
    }
    await shot(page, '3-rendered');
    await dumpControls(page, '3-rendered');

    if (!url) {
      log('\n  [X] preview ka mp4 URL nahi mila. ui/3-rendered.png aur .txt dekho.');
      log('      (Generate NAHI dabaya — koi credit kharch nahi hua)');
      failed = true;
      return;
    }

    log(`\n  URL: ${url.slice(0, 110)}...`);

    // ---- 5. download ----
    fs.mkdirSync(OUT, { recursive: true });
    const dest = OUT_FILE || path.join(OUT, `heygen_preview_${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`download ${r.status} ${r.statusText}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    log(`\n  ✅ download ho gayi: ${path.relative(ROOT, dest)}  (${(buf.length / 1048576).toFixed(1)} MB)`);
    log('     Generate kabhi nahi dabaya.');
  } catch (e) {
    log(`\n[X] ERROR: ${e.message}`);
    failed = true;
  } finally {
    if (AUTO) {
      log('\n  browser band kar raha hun (pipeline mode).');
      await ctx.close().catch(() => {});
      process.exit(failed ? 1 : 0);
    }
    log('\n  browser khula chhod raha hun — dekh lo, phir khud band kar do.');
    await new Promise(res => ctx.on('close', res)).catch(() => {});
    process.exit(0);
  }
})();
