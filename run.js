// ============================================================
//  ORCHESTRATOR — ek click, 9 stages
//
//    node run.js                     saari videos, saare stages
//    node run.js --video="video 1"   sirf ek video
//    node run.js --only=stock        sirf ek stage (naam ya number)
//    node run.js --from=7            stage 7 se aage
//    node run.js --redo              state.json ignore, sab dobara
//    node run.js --list              kya banega, kuch chalaye bagair
//
//  Har stage ka nateeja state.json mein likha jata hai — beech mein ruke to
//  dobara chalane par wahin se shuru hota hai, poora dobara nahi.
// ============================================================
const fs = require('fs');
const path = require('path');
const U = require('./lib/util.js');

// werewolf-alpha-romance: fiction, images-only niche (PATTERN=['image'] in
// stages/3-timeline.js, config.ratio = {avatar:0, images:100, stock:0}).
// facts/keywords/avatar/stock stages removed 2026-08-17 — facts had a
// hardcoded "Amish farming documentary" prompt that corrupted a real script
// (fact-checking real-world claims against fiction doesn't make sense as an
// operation anyway), and keywords/avatar/stock are structurally guaranteed
// to have zero slots to process in this niche, so they were dead weight.
const STAGES = [
  { n: 1, key: 'script',    file: '1-script.js',    what: 'script (deepseek)' },
  // thumbnail ab images (6) se PEHLE banta hai — script.txt ke ilawa kuch
  // nahi chahiye, aur is se banayi gayi thumbnail baaki sab images ke liye
  // style-reference ban jati hai (stage 6 use karta hai, character consistency).
  { n: 1.7, key: 'thumbnail', file: '10-thumbnail.js', what: 'thumbnail (pehle — baaki images ke liye reference banega)' },
  { n: 2, key: 'voice',     file: '2-voice.js',     what: 'voiceover + SRT (Kokoro local — production voice ab Chatterbox/pod se banti hai, ye local fallback hai)' },
  { n: 3, key: 'timeline',  file: '3-timeline.js',  what: 'timeline — SRT se image slots' },
  { n: 4, key: 'prompts',   file: '4-prompts.js',   what: 'image prompts + character split' },
  { n: 6, key: 'images',    file: '6-images.js',    what: 'images (Gemini)' },
  { n: 9, key: 'render',      file: '9-render.js',    what: 'render — pura ffmpeg (final.mp4)' },
];

const arg = (name, def = null) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=').replace(/^["']|["']$/g, '') : def;
};
const flag = name => process.argv.includes(`--${name}`);

function chosen() {
  const only = arg('only');
  const from = Number(arg('from', 0));
  let list = STAGES;
  if (only) {
    const want = only.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    list = STAGES.filter(s => want.includes(s.key) || want.includes(String(s.n)));
    const missing = want.filter(w => !STAGES.some(s => s.key === w || String(s.n) === w));
    if (missing.length) { U.bad(`stage "${missing.join(', ')}" nahi mila`); process.exit(1); }
  } else if (from) list = STAGES.filter(s => s.n >= from);
  return list;
}

(async () => {
  const cfg = U.config();
  const e = U.env();
  const line = () => U.log('='.repeat(62));

  line();
  U.log('  VIDEO PIPELINE');
  line();

  let videos = U.listVideos();
  const one = arg('video');
  if (one) videos = videos.filter(f => f.toLowerCase().includes(one.toLowerCase()));
  if (!videos.length) {
    U.bad('videos/ mein koi .md file nahi mili');
    U.log('   misaal: videos/video 1.md  (andar "Topic:" aur "Minutes:" likho)');
    process.exit(1);
  }

  const stages = chosen();
  U.log(`\n  videos: ${videos.length}   |   stages: ${stages.map(s => s.n).join(',')}`);

  // ---- keys ka check — sirf un stages ke liye jo chuni gayi hain (render
  // jaise stage ko koi external API key nahi chahiye, pod par isi liye zaroorat nahi) ----
  const KEY_STAGES = { YUNWU_API_KEY: ['script', 'prompts', 'keywords', 'stock', 'thumbnail'] };
  const missing = Object.keys(KEY_STAGES).filter(k => KEY_STAGES[k].some(sk => stages.some(s => s.key === sk)) && !e[k]);
  if (missing.length) {
    U.bad('ye keys .env mein nahi mili:');
    missing.forEach(k => U.log(`      ${k}`));
    U.log('\n   .env.example ko .env bana kar apni keys daalo.');
    process.exit(1);
  }
  U.ok('keys mil gayin');

  if (flag('list')) {
    for (const f of videos) {
      const sp = U.loadVideoSpec(f);
      const st = U.loadState(sp.id);
      U.log(`\n  ${f}  (id: ${sp.id})`);
      U.log(`     topic: ${(sp.topic_text || sp.topic || '?').slice(0, 60)}`);
      U.log(`     minutes: ${sp.minutes || 15}`);
      U.log(`     ho chuke: ${Object.keys(st.done).join(', ') || '(kuch nahi)'}`);
    }
    return;
  }

  for (const file of videos) {
    const spec = U.loadVideoSpec(file);
    const st = flag('redo') ? { done: {}, meta: {} } : U.loadState(spec.id);
    fs.mkdirSync(U.workDir(spec.id), { recursive: true });

    line();
    U.log(`  VIDEO: ${file}   →  work/${spec.id}/`);
    line();

    // Ek stage chalane ka helper
    const runOne = async (s) => {
      U.step(`${s.n}. ${s.what}`);
      const fn = require(path.join(__dirname, 'stages', s.file));
      const t0 = Date.now();
      await fn(spec, cfg, st);
      st.done[s.key] = { at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) };
      U.saveState(spec.id, st);
    };
    const pending = s => (!st.done[s.key] || flag('redo'));
    const only = stages;                                   // is run ke stages

    // Poori pipeline (--only nahi) → 3 marhale:
    //   A) sequential: script..keywords (har agla pichle par depend)
    //   B) PARALLEL:   images(6) + stock(8) + avatar(7) — teenon SRT+timeline
    //      par depend karte hain, aapas mein nahi. SRT bante hi scraping AUR
    //      images dono ek sath (user ki farmaish), ghante bachte hain.
    //   C) sequential: render(9), thumbnail(10)
    const PAR = new Set(['images', 'stock', 'avatar']);
    const fullRun = only.length > 3;
    let broke = false;

    const runSeq = async (subset) => {
      for (const s of subset) {
        if (!pending(s)) { U.log(`\n  ── ${s.n}. ${s.what}  (pehle ho chuka, skip)`); continue; }
        try { await runOne(s); }
        catch (err) {
          U.bad(`stage ${s.n} (${s.key}) fail: ${err.message}`);
          U.saveState(spec.id, st);
          U.log(`\n   Sirf isay chalao:  node run.js --video="${file.replace(/\.md$/, '')}" --only=${s.key}`);
          U.log(`   Ya aage se:        node run.js --video="${file.replace(/\.md$/, '')}" --from=${s.n}`);
          broke = true; return;
        }
      }
    };

    if (fullRun) {
      await runSeq(only.filter(s => !PAR.has(s.key) && s.n < 6));       // A
      if (!broke) {
        const group = only.filter(s => PAR.has(s.key) && pending(s));
        if (group.length) {
          U.log(`\n  ── ${group.map(g => g.n + '.' + g.key).join(' + ')} EK SATH (parallel) ──`);
          const res = await Promise.allSettled(group.map(g => runOne(g)));
          res.forEach((r, k) => { if (r.status === 'rejected') { broke = true; U.bad(`stage ${group[k].key} fail: ${r.reason?.message || r.reason}`); } });
        }
      }
      if (!broke) await runSeq(only.filter(s => !PAR.has(s.key) && s.n >= 6));  // C
    } else {
      await runSeq(only);                                                // --only / chhota chunk = seedha
    }

    const done = Object.keys(st.done);
    U.log(`\n  ${file}: ${done.length}/${STAGES.length} stages — ${done.join(', ')}`);
    if (st.meta.projectDir) U.log(`  project: ${path.relative(U.ROOT, st.meta.projectDir)}`);
  }

  line();
  U.log('  KHATAM');
  line();
})();
