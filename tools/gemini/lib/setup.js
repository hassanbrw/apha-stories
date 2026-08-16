// ============================================================
//  SETUP — tumhari Chrome ki saari profiles tool ke liye tayyar karta hai
//  Har profile ki COPY banti hai. Tumhari asli Chrome ko kuch nahi hota.
//  Login copy ke sath aati hai, isliye dobara login karne ki zaroorat nahi.
// ============================================================
const fs = require('fs');
const path = require('path');
const C = require('./common.js');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

function line() { console.log('============================================================'); }

(async () => {
  line();
  console.log('  BULK IMAGE TOOL — SETUP');
  line();

  // 1. playwright maujood hai?
  try { require.resolve('playwright'); }
  catch {
    console.log('\n[X] playwright install nahi hui.');
    console.log('    Launcher (SETUP) dobara chalao — woh khud install kar deta hai.');
    process.exit(1);
  }
  console.log('[OK] playwright maujood hai');

  // 2. Chrome ki profiles
  const root = C.chromeUserDataRoot();
  if (!fs.existsSync(root)) {
    console.log(`\n[X] Google Chrome ka data folder nahi mila:\n    ${root}`);
    console.log('    Chrome install karo aur ek dafa chala kar login kar lo, phir SETUP dobara chalao.');
    process.exit(1);
  }

  const profiles = C.listChromeProfiles();
  if (!profiles.length) {
    console.log('\n[X] Chrome mein koi profile nahi mili.');
    console.log('    Chrome kholo, apne account se login karo, phir SETUP dobara chalao.');
    process.exit(1);
  }

  console.log(`\nTumhari Chrome mein ${profiles.length} profile(s) mili:\n`);
  console.log('  #   FOLDER          NAAM                  EMAIL');
  profiles.forEach((p, i) => {
    console.log(`  ${String(i + 1).padEnd(3)} ${p.folder.padEnd(15)} ${p.name.slice(0, 20).padEnd(21)} ${p.email || '(koi account nahi)'}`);
  });

  // DEFAULT tareeqa: koi copy nahi — tool in hi asli profiles par kaam karta hai
  if (C.loadSettings().useRealChrome === true) {
    line();
    console.log('  Sab tayyar hai — koi copy banane ki zaroorat nahi.');
    console.log('  Tool UPAR wali asli profiles par hi kaam karega, tumhari apni login ke sath.');
    console.log('');
    console.log(`  Har profile par ${C.loadSettings().imagesPerProfile} images, phir khud agli profile par.`);
    console.log(`  Yaani ~${profiles.length * C.loadSettings().imagesPerProfile} images ek run mein.`);
    console.log('');
    console.log('  EK SHART: RUN chalane se pehle Chrome POORI TARAH band karni hai');
    console.log(C.IS_WIN ? '            (Task Manager -> chrome.exe -> End task)'
      : '            (Chrome par Cmd+Q — sirf window band karna kaafi nahi)');
    console.log('');
    console.log('  Ab: prompts/ folder mein apni txt files daalo, phir RUN chalao.');
    line();
    process.exit(0);
  }

  // 3. Chrome band honi chahiye (warna cookies adhoori copy hoti hain)
  if (C.chromeRunning()) {
    console.log('\n------------------------------------------------------------');
    console.log('[!] Chrome abhi CHAL rahi hai.');
    console.log('    Cookies adhoori copy hongi aur login kaam nahi karegi.');
    console.log('');
    console.log('    Chrome ko poori tarah band karo:');
    console.log(C.IS_WIN ? '      Chrome ki saari windows band karo (ya Task Manager se chrome.exe end karo)'
      : '      Chrome par Cmd+Q dabao (sirf window band karna kaafi nahi)');
    console.log('    Phir SETUP dobara chalao.');
    console.log('------------------------------------------------------------');
    process.exit(1);
  }
  console.log('\n[OK] Chrome band hai — copy shuru');

  // 4. copy
  fs.mkdirSync(C.PROFILE_DIR, { recursive: true });
  let made = 0, skipped = 0, warned = 0;

  profiles.forEach((p, i) => {
    const dstName = `p${String(i + 1).padStart(2, '0')}-${p.folder.replace(/\s+/g, '')}`;
    const dstDir = path.join(C.PROFILE_DIR, dstName);
    // nayi Chrome cookies Default/Network/Cookies mein rakhti hai, aur chaabi Local State mein
    const already = C.profileHasLogin(dstDir) && C.profileHasKey(dstDir);

    if (already && !FORCE) {
      console.log(`  [skip] ${dstName}  (pehle se tayyar hai)`);
      skipped++;
      return;
    }
    process.stdout.write(`  [copy] ${dstName}  ${p.email || p.name} ... `);
    try {
      C.copyProfile(p.folder, dstDir);
      const okLogin = C.profileHasLogin(dstDir);
      const okKey = C.profileHasKey(dstDir);
      console.log(okLogin && okKey ? 'ho gaya' : `ho gaya (login=${okLogin ? 'ok' : 'NAHI'}, chaabi=${okKey ? 'ok' : 'NAHI'})`);
      if (!okLogin || !okKey) warned++;
      made++;
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  });

  const ready = C.listToolProfiles();
  line();
  console.log(`  TAYYAR: ${ready.length} profile(s)   (nayi: ${made}, pehle se: ${skipped})`);
  ready.forEach(r => console.log(`    - ${r}`));
  line();
  if (warned) {
    console.log('\n  [!] Kuch profiles mein login ya chaabi adhoori mili.');
    console.log('      Iska matlab: browser khulega to account LOGGED OUT dikhega.');
    console.log('      Hal 1: Chrome POORI TARAH band karo aur SETUP dobara chalao');
    console.log('      Hal 2: settings.json mein "useRealChrome": true kar do');
    console.log('             (phir copy ki zaroorat nahi, asli Chrome profiles use hongi —');
    console.log('              lekin kaam ke dauran Chrome band rehni chahiye)');
    console.log('      Hal 3: us profile ki window mein ek dafa KHUD login kar lo, save ho jayegi');
  }

  const s = C.loadSettings();
  console.log(`\n  Har profile par ${s.imagesPerProfile} images ke baad tool khud agli profile par chala jayega.`);
  console.log(`  Yaani zyada se zyada ~${ready.length * s.imagesPerProfile} images ek run mein.`);
  console.log('\n  Ab: prompts/ folder mein apni txt files daalo, phir RUN chalao.');
  process.exit(0);
})();
