// ============================================================
//  RUN — prompts/ ki har txt file = ek video. 16:9 hamesha locked.
//  mode "normal"    = character consistency OFF
//  mode "character" = character consistency ON (reference/ se character image)
//  Ek profile ki limit poori ho to khud agli profile par chala jata hai.
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const C = require('./common.js');

const MODE = (process.argv[2] || 'normal').toLowerCase() === 'character' ? 'character' : 'normal';
const USE_CHAR = MODE === 'character';
const PER_PROMPT_MS = USE_CHAR ? 60 * 1000 : 45 * 1000;

const S = C.loadSettings();
const BATCH = Math.max(1, (S.batchSize && S.batchSize[MODE]) || (USE_CHAR ? 25 : 50));
const LIMIT = Math.max(1, S.imagesPerProfile || 1000);

function line() { console.log('============================================================'); }
const totalOf = (videos, state) => videos.reduce((s, v) => s + (state.progress[v.key] || 0), 0);

(async () => {
  line();
  console.log(`  BULK IMAGE TOOL — ${USE_CHAR ? 'WITH CHARACTER CONSISTENCY' : 'NORMAL'}  (16:9)`);
  line();

  const videos = C.loadVideos();
  if (!videos.length) {
    console.log('\n[X] prompts/ folder mein koi txt file nahi mili (ya woh khaali hain).');
    console.log('    prompts/ mein "video 1.txt" jaisi file banao — ek line = ek image.');
    process.exit(1);
  }

  // DO TAREEQE:
  //  A) copy mode (default): profiles/ ki copies use hoti hain, asli Chrome chalti reh sakti hai
  //  B) direct mode (settings: "useRealChrome": true): TUMHARI ASLI Chrome profiles
  //     seedha use hoti hain — copy ka koi jhagra nahi, login pakka. Lekin poore
  //     kaam ke dauran Chrome BAND rehni chahiye.
  const DIRECT = S.useRealChrome === true;
  let profiles;

  if (DIRECT) {
    const real = C.listChromeProfiles();
    if (!real.length) {
      console.log('\n[X] Chrome mein koi profile nahi mili.');
      console.log(`    Dekha yahan: ${C.chromeUserDataRoot()}`);
      process.exit(1);
    }
    if (C.chromeRunningForRoot(C.chromeUserDataRoot())) {
      console.log('\n------------------------------------------------------------');
      console.log('[X] "useRealChrome" on hai, is liye Chrome BAND honi chahiye.');
      console.log(C.IS_WIN ? '    Chrome ki saari windows band karo (Task Manager -> chrome.exe -> End task)'
        : '    Chrome par Cmd+Q dabao (sirf window band karna kaafi nahi)');
      console.log('    Phir ye RUN dobara chalao.');
      console.log('------------------------------------------------------------');
      process.exit(1);
    }
    // settings mein "onlyProfiles" ho to sirf wahi (folder naam ya email se match)
    const only = Array.isArray(S.onlyProfiles) ? S.onlyProfiles.filter(Boolean) : [];
    let chosen = real;
    if (only.length) {
      const want = only.map(x => String(x).toLowerCase().trim());
      chosen = real.filter(p => want.includes(p.folder.toLowerCase()) || want.includes((p.email || '').toLowerCase()));
      const notFound = want.filter(w => !real.some(p => p.folder.toLowerCase() === w || (p.email || '').toLowerCase() === w));
      if (notFound.length) console.log(`\n  [!] "onlyProfiles" mein ye nahi mile: ${notFound.join(', ')}`);
      if (!chosen.length) {
        console.log('\n[X] "onlyProfiles" se koi profile match nahi hui. settings.json theek karo ya usay khaali [] kar do.');
        process.exit(1);
      }
    }
    profiles = chosen.map(p => p.folder);
    console.log('\n  ------------------------------------------------------------');
    console.log('  [direct mode] TUMHARI ASLI Chrome profiles use ho rahi hain.');
    console.log('  KHATRA: is se Chrome ke account SIGN OUT ho sakte hain (dobara');
    console.log('  login karna pare ga). Mehfooz tareeqa: settings.json mein');
    console.log('  "useRealChrome": false rakho — tab copies par kaam hota hai.');
    console.log('  ------------------------------------------------------------');
    chosen.forEach(p => console.log(`      ${p.folder.padEnd(12)} ${p.email || p.name}`));
  } else {
    profiles = C.listToolProfiles();
    if (!profiles.length) {
      console.log('\n[X] koi profile tayyar nahi.  Pehle SETUP chalao.');
      process.exit(1);
    }
    // chaabi/login check — copy adhoori ho to pehle hi bata do
    const broken = profiles.filter(p => {
      const d = path.join(C.PROFILE_DIR, p);
      return !C.profileHasLogin(d) || !C.profileHasKey(d);
    });
    if (broken.length === profiles.length) {
      console.log('\n------------------------------------------------------------');
      console.log('[X] Saari profiles mein login/chaabi adhoori hai — account logged out milega.');
      console.log('    Chrome POORI TARAH band karo, phir SETUP dobara chalao.');
      console.log('    Ya settings.json mein "useRealChrome": true kar do (asli Chrome use hogi).');
      console.log('------------------------------------------------------------');
      process.exit(1);
    }
    if (broken.length) console.log(`\n  [!] in profiles mein login adhoori lagti hai: ${broken.join(', ')}`);
  }

  const state = C.loadState(MODE);
  state.used = state.used || {}; state.progress = state.progress || {};

  // har video ke references pehle hi dekh lo (taake masla shuru mein pata chale)
  const refsFor = {};
  let missingChar = [];
  for (const v of videos) {
    refsFor[v.key] = C.resolveRefs(v.key);
    if (USE_CHAR && !refsFor[v.key].character) missingChar.push(v.file);
  }

  const totalPrompts = videos.reduce((s, v) => s + v.prompts.length, 0);
  console.log(`\n  Videos: ${videos.length}   |   kul prompts: ${totalPrompts}   |   batch: ${BATCH}`);
  for (const v of videos) {
    const r = refsFor[v.key];
    const tags = [
      USE_CHAR ? (r.character ? `character: ${path.basename(r.character)}` : 'character: MISSING') : null,
      r.style ? `style: ${path.basename(r.style)}` : null,
    ].filter(Boolean).join('   ');
    console.log(`    ${v.file.padEnd(24)} ${String(v.prompts.length).padStart(4)} prompts   ${tags}`);
  }
  console.log(`\n  Profiles: ${profiles.length}  (har ek par ${LIMIT} images)`);
  const done0 = totalOf(videos, state);
  if (done0) console.log(`  Resume: ${done0}/${totalPrompts} pehle ho chuki hain`);

  if (USE_CHAR && missingChar.length) {
    console.log('\n------------------------------------------------------------');
    console.log('[X] Character mode ke liye character ki image chahiye, lekin ye videos ke liye nahi mili:');
    missingChar.forEach(f => console.log(`      ${f}`));
    console.log('');
    console.log('    Character image yahan rakho (koi bhi jpg/png):');
    console.log('      reference/character/         <- sab videos ke liye ek hi character');
    console.log('      reference/<video naam>/character.jpg   <- us video ka apna character');
    console.log('------------------------------------------------------------');
    process.exit(1);
  }

  // ---------- profile by profile ----------
  for (const profileName of profiles) {
    if (totalOf(videos, state) >= totalPrompts) break;

    let budget = LIMIT - (state.used[profileName] || 0);
    if (budget <= 0) { console.log(`\n  [skip] ${profileName} — limit poori ho chuki`); continue; }

    line();
    console.log(`  PROFILE: ${profileName}   (${state.used[profileName] || 0}/${LIMIT} use ho chuki)`);
    line();

    const userDataDir = DIRECT ? C.chromeUserDataRoot() : path.join(C.PROFILE_DIR, profileName);
    const extraArgs = DIRECT ? [`--profile-directory=${profileName}`] : [];
    if (!DIRECT) C.clearLocks(profileName);

    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: S.browser || 'chrome',
        acceptDownloads: true,
        viewport: null,
        // ZAROORI: Playwright default mein --use-mock-keychain aur --password-store=basic
        // deta hai. In se Chrome asli keychain use nahi karta, purane sign-in tokens
        // decrypt nahi hote aur account SIGN OUT ho jata hai. Isliye ye hata rahe hain.
        ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
        args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', ...extraArgs],
      });
    } catch (e) {
      console.log(`  [!] browser khul nahi saka: ${e.message}`);
      console.log('      (agar "already in use" likha hai to Chrome band karo aur dobara chalao)');
      continue;
    }

    try {
      const page = ctx.pages()[0] || await ctx.newPage();
      const frame = await C.waitForTool(ctx, page, S.toolUrl, profileName);
      if (!frame) { console.log('  [!] tool nahi mila — agli profile try karta hun'); continue; }
      const toolPage = frame.page();
      console.log('  [OK] tool mil gaya');

      let currentVideo = null;
      let rotate = false;

      for (const v of videos) {
        if (rotate) break;
        while ((state.progress[v.key] || 0) < v.prompts.length) {
          if (budget <= 0) { console.log(`  [i] ${profileName} ki limit poori — agli profile`); rotate = true; break; }

          // video badla ya settings gayab — dobara lagao (har video ka apna reference)
          const live = await C.readSettingsFromPage(frame);
          const needChar = USE_CHAR && !!refsFor[v.key].character;
          const needStyle = !!refsFor[v.key].style;
          const bad = live.aspect !== 'landscape'
            || live.cc !== needChar || live.sc !== needStyle
            || (needChar && !live.ccFile) || (needStyle && !live.scFile);

          if (currentVideo !== v.key || bad) {
            await C.applySettings(frame, { useCharacter: USE_CHAR, refs: refsFor[v.key] });
            const chk = await C.readSettingsFromPage(frame);
            console.log(`  settings [${v.file}]  16:9=${chk.aspect === 'landscape' ? 'YES' : 'NO'}  character=${chk.cc ? chk.ccFile : 'off'}  style=${chk.sc ? chk.scFile : 'off'}`);
            if (chk.aspect !== 'landscape' || chk.cc !== needChar || chk.sc !== needStyle) {
              console.log('  [X] settings theek nahi lagin — ruk gaya (galat images banane se behtar)');
              rotate = true; break;
            }
            currentVideo = v.key;
          }

          const done = state.progress[v.key] || 0;
          const size = Math.min(BATCH, budget, v.prompts.length - done);
          const batch = v.prompts.slice(done, done + size);
          const batchNo = state.batchNo + 1;

          let res;
          try {
            res = await C.generateBatch(toolPage, frame, batch,
              `${v.id}_b${String(batchNo).padStart(3, '0')}`,
              `${v.id} [${done + 1}-${done + size}]`, PER_PROMPT_MS);
          } catch (e) {
            console.log(`  [!] batch fail: ${e.message}`);
            console.log('      agli profile par jata hun (ye prompts dobara chalengi)');
            rotate = true; break;
          }

          state.batchNo = batchNo; C.saveState(MODE, state);

          if (!res.zipPath || res.made === 0) {
            console.log('  [i] koi image nahi bani — is account ki limit lagti hai. Agli profile.');
            rotate = true; break;
          }

          const saved = C.saveRenamed(res.zipPath, v, done + 1, size, batchNo);
          if (!saved.ok) {
            state.used[profileName] = (state.used[profileName] || 0) + saved.got;
            budget -= saved.got;
            C.saveState(MODE, state);
            if (saved.got === 0) { rotate = true; }
            continue;   // ye chunk dobara chalega
          }

          state.progress[v.key] = done + size;
          state.used[profileName] = (state.used[profileName] || 0) + size;
          budget -= size;
          C.saveState(MODE, state);
          console.log(`    ${v.id}: ${state.progress[v.key]}/${v.prompts.length}   |   kul: ${totalOf(videos, state)}/${totalPrompts}   |   ${profileName}: ${state.used[profileName]}/${LIMIT}`);

          await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
        }
        if (!rotate && (state.progress[v.key] || 0) >= v.prompts.length) {
          console.log(`  [done] ${v.file} mukammal -> output/${v.id}/`);
        }
      }
    } catch (e) {
      console.log(`  [!] profile error: ${e.message}`);
    } finally {
      await ctx.close().catch(() => {});
      await new Promise(r => setTimeout(r, 3000));   // lock chhootne do
    }
  }

  const done = totalOf(videos, state);
  line();
  if (done >= totalPrompts) {
    console.log(`  KHATAM — ${done} images ban gayin. output/ folder dekho.`);
  } else {
    console.log(`  RUKA — ${done}/${totalPrompts} images banin.`);
    console.log('  Saari profiles ki limit khatam ho gayi ya tool nahi mila.');
    console.log('  Naye account ke liye: ADD-NEW-ACCOUNT chalao, ya kal dobara RUN chalao.');
    console.log('  (Progress save hai — jahan ruka tha wahin se chalega.)');
  }
  line();
  process.exit(0);
})();
