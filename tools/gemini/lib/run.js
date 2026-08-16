// ============================================================
//  RUN — prompts/ ki har txt file = ek video. 16:9 hamesha locked.
//  mode "normal"    = character consistency OFF
//  mode "character" = character consistency ON (reference/ se character image)
//
//  PARALLEL PROFILES (2026-08-17): pehle profiles ek ek kar ke (sequential)
//  chalti thin — poori generation time is se lambi ho jati thi (500ish
//  prompts, 50/batch, 1 profile = sab kuch ek browser se). Ab har video ke
//  prompts profiles ki tadaad mein STATIC baraabar hisson mein baant diye
//  jate hain (profile 1 = [0,half), profile 2 = [half,end) waghera), aur
//  saari profiles apna apna hissa EK SATH (Promise.all) chalati hain.
//
//  Static (fixed) taqseem jaan-boojh kar hai, dynamic "jo khaali ho wo agla
//  le le" nahi — kyunki dynamic taqseem mein shared state.progress counter
//  par race condition ka khatra hota (do profiles ek sath "done" parhtin,
//  dono apna kaam kar ke ALAG waqt par likhtin, ek doosre ka update mita
//  deti). Static taqseem mein har profile SIRF apne hisse ka progress
//  likhti hai (state.progress[v.key][profileName]) — kisi doosri profile ka
//  data kabhi chhoo hi nahi sakti, is liye race condition mumkin hi nahi.
//  Nuqsan: agar ek profile dheemi/fail ho to doosri us ka kaam nahi le sakti
//  (perfect load-balance nahi) — lekin N profiles se roughly Nx speedup
//  milta hai, aur ye tareeqa GALAT ban jane se zyada mehfooz hai.
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

// har video ke liye: total done = saari profiles ke apne apne hisson ka jama
function totalDoneFor(v, state) {
  const p = state.progress[v.key];
  if (!p) return 0;
  if (typeof p === 'number') return p;   // purana (pre-parallel) format — migration
  return Object.values(p).reduce((a, n) => a + n, 0);
}
const totalOf = (videos, state) => videos.reduce((s, v) => s + totalDoneFor(v, state), 0);

// har video ke prompts ko N profiles mein STATIC baraabar hisson mein baanto
// (aakhri hissa bacha hua sab le leta hai, taake round-off se koi prompt na chhoote)
function slicesFor(v, profileNames) {
  const n = profileNames.length;
  const total = v.prompts.length;
  const per = Math.floor(total / n);
  const slices = {};
  let start = 0;
  profileNames.forEach((name, i) => {
    const end = i === n - 1 ? total : start + per;
    slices[name] = { start, end };
    start = end;
  });
  return slices;
}

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
  // purana format (state.progress[key] = number) mila to migrate karo: pehli
  // profile ko wo saara kaam "kar chuki" maan lo, baaki profiles 0 se shuru
  for (const v of videos) {
    if (typeof state.progress[v.key] === 'number') {
      state.progress[v.key] = { [profiles[0]]: state.progress[v.key] };
    }
  }

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
  console.log(`\n  Profiles: ${profiles.length}  (har ek par ${LIMIT} images, PARALLEL chalengi)`);
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

  // har video ke prompts profiles mein static baant do (ek dafa, shuru mein)
  const sliceMap = {};   // v.key -> { profileName: {start, end} }
  for (const v of videos) sliceMap[v.key] = slicesFor(v, profiles);

  // ---------- ek profile ka poora kaam (apne slice tak mehdood) ----------
  async function runProfile(profileName) {
    let budget = LIMIT - (state.used[profileName] || 0);
    if (budget <= 0) { console.log(`\n  [skip] ${profileName} — limit poori ho chuki`); return; }

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
        ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain', '--password-store=basic'],
        args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', ...extraArgs],
      });
    } catch (e) {
      console.log(`  [!] ${profileName}: browser khul nahi saka: ${e.message}`);
      console.log('      (agar "already in use" likha hai to Chrome band karo aur dobara chalao)');
      return;
    }

    try {
      const page = ctx.pages()[0] || await ctx.newPage();
      const frame = await C.waitForTool(ctx, page, S.toolUrl, profileName);
      if (!frame) { console.log(`  [!] ${profileName}: tool nahi mila`); return; }
      const toolPage = frame.page();
      console.log(`  [OK] ${profileName}: tool mil gaya`);

      let currentVideo = null;

      for (const v of videos) {
        const slice = sliceMap[v.key][profileName];
        if (!slice || slice.start >= slice.end) continue;   // is profile ko is video ka kaam nahi mila

        state.progress[v.key] = state.progress[v.key] || {};
        let localDone = state.progress[v.key][profileName] || 0;   // slice ke andar, 0-based offset
        const sliceLen = slice.end - slice.start;

        while (localDone < sliceLen) {
          if (budget <= 0) { console.log(`  [i] ${profileName} ki limit poori — is profile ka kaam ruk gaya`); return; }

          const live = await C.readSettingsFromPage(frame);
          const needChar = USE_CHAR && !!refsFor[v.key].character;
          const needStyle = !!refsFor[v.key].style;
          const bad = live.aspect !== 'landscape'
            || live.cc !== needChar || live.sc !== needStyle
            || (needChar && !live.ccFile) || (needStyle && !live.scFile);

          if (currentVideo !== v.key || bad) {
            await C.applySettings(frame, { useCharacter: USE_CHAR, refs: refsFor[v.key] });
            const chk = await C.readSettingsFromPage(frame);
            console.log(`  ${profileName} settings [${v.file}]  16:9=${chk.aspect === 'landscape' ? 'YES' : 'NO'}  character=${chk.cc ? chk.ccFile : 'off'}  style=${chk.sc ? chk.scFile : 'off'}`);
            if (chk.aspect !== 'landscape' || chk.cc !== needChar || chk.sc !== needStyle) {
              console.log(`  [X] ${profileName}: settings theek nahi lagin — ruk gaya (galat images banane se behtar)`);
              return;
            }
            currentVideo = v.key;
          }

          const size = Math.min(BATCH, budget, sliceLen - localDone);
          const globalStart = slice.start + localDone;   // v.prompts mein asli (global) position
          const batch = v.prompts.slice(globalStart, globalStart + size);
          const batchNo = ++state.batchNo; C.saveState(MODE, state);

          let res;
          try {
            res = await C.generateBatch(toolPage, frame, batch,
              `${v.id}_${profileName}_b${String(batchNo).padStart(3, '0')}`,
              `${v.id} [${globalStart + 1}-${globalStart + size}] (${profileName})`, PER_PROMPT_MS);
          } catch (e) {
            console.log(`  [!] ${profileName} batch fail: ${e.message}`);
            return;
          }

          if (!res.zipPath || res.made === 0) {
            console.log(`  [i] ${profileName}: koi image nahi bani — is account ki limit lagti hai.`);
            return;
          }

          // startSeq = GLOBAL position (v.prompts ke andar), local slice offset nahi
          const saved = C.saveRenamed(res.zipPath, v, globalStart + 1, size, batchNo);
          if (!saved.ok) {
            localDone += saved.got;
            state.progress[v.key][profileName] = localDone;
            state.used[profileName] = (state.used[profileName] || 0) + saved.got;
            budget -= saved.got;
            C.saveState(MODE, state);
            if (saved.got === 0) return;
            continue;
          }

          localDone += size;
          state.progress[v.key][profileName] = localDone;
          state.used[profileName] = (state.used[profileName] || 0) + size;
          budget -= size;
          C.saveState(MODE, state);
          console.log(`    ${profileName} | ${v.id}: ${localDone}/${sliceLen} (apna hissa)   |   kul: ${totalOf(videos, state)}/${totalPrompts}   |   ${profileName}: ${state.used[profileName]}/${LIMIT}`);

          await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
        }
        console.log(`  [done] ${profileName}: ${v.file} ka apna hissa mukammal`);
      }
    } catch (e) {
      console.log(`  [!] ${profileName} error: ${e.message}`);
    } finally {
      await ctx.close().catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // ---------- saari profiles EK SATH chalao ----------
  await Promise.all(profiles.map(runProfile));

  const done = totalOf(videos, state);
  line();
  if (done >= totalPrompts) {
    console.log(`  KHATAM — ${done} images ban gayin. output/ folder dekho.`);
  } else {
    console.log(`  RUKA — ${done}/${totalPrompts} images banin.`);
    console.log('  Kisi profile ki limit khatam ho gayi ya tool nahi mila.');
    console.log('  Naye account ke liye: ADD-NEW-ACCOUNT chalao, ya dobara RUN chalao.');
    console.log('  (Progress save hai — jahan ruka tha wahin se chalega.)');
  }
  line();
  process.exit(0);
})();
