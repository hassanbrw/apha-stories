// ============================================================
//  RUN ON POD — poora remote voice+render workflow, ek command se
//
//  istemal:
//    node pod/run-on-pod.js --video="<id>"                          (Vast.ai, default — voice+render dono)
//    node pod/run-on-pod.js --video="<id>" --voice-only              (sirf voice, timeline/images abhi nahi bane)
//    node pod/run-on-pod.js --video="<id>" --render-only             (voice/ pehle se local mein achi hai, seedha render)
//    node pod/run-on-pod.js --video="<id>" --provider=runpod --gpu="NVIDIA A100 80GB PCIe"
//    node pod/run-on-pod.js --video="<id>" --provider=vast --gpu="RTX 5090" --min-cores=90
//
//  ZAROORI TARTEEB: render ko timeline.json + images/ chahiye, aur wo dono
//  khud VOICE ke baad, LOCAL pipeline (stages 3-6) se bantay hain (timeline
//  voice ki word-by-word timing se banti hai). Is liye ek fresh video ke
//  liye --voice-only pehle chalao, phir local se timeline/images bana lo,
//  phir doosri dafa (bina --voice-only) render ke liye pod rent karo.
//
//  1) local se R2 par: script.txt (+ agar voice-only nahi to timeline.json,
//     images/, thumbnail/ bhi)
//  2) GPU instance banao (Docker image se — pehle GitHub Actions se
//     build+push honi chahiye, pod/README.md dekho)
//  3) instance khud R2 se download karta hai, voice (Kokoro, parallel) [+ render
//     agar voice-only nahi], phir R2 par upload kar deta hai (entrypoint.sh dekho)
//  4) jab kaam khatam ho (container exit), R2 se voice/ [+ final.mp4/captions/
//     agar voice-only nahi] wapas local par download karo
//  5) instance HAMESHA DELETE karo (sirf stop nahi — disk billing chalti
//     rehti hai, ye wahi $7 wala masla hai jo pehle mila tha)
// ============================================================
const fs = require('fs');
const path = require('path');
const U = require('../lib/util.js');
const R2 = require('./r2.js');
const RunPod = require('./runpod.js');
const Vast = require('./vast.js');

const arg = (name, def = null) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=').replace(/^["']|["']$/g, '') : def;
};

(async () => {
  const videoArg = arg('video');
  if (!videoArg) { U.bad('--video="<id>" dena zaroori hai'); process.exit(1); }
  const videos = U.listVideos().filter(f => f.toLowerCase().includes(videoArg.toLowerCase()));
  if (!videos.length) { U.bad(`videos/ mein "${videoArg}" se milta koi video nahi mila`); process.exit(1); }
  const spec = U.loadVideoSpec(videos[0]);
  const cfg = U.config();
  const id = spec.id;
  const provider = arg('provider', 'vast'); // user ka faisla: Vast.ai sasta nikla RunPod se
  const imageName = U.env().POD_IMAGE_NAME;
  if (!imageName) { U.bad('.env mein POD_IMAGE_NAME nahi mila (Docker image jo push ki gayi hai)'); process.exit(1); }

  // RENDER_ONLY: voice/ already achi/verified hai (pichle pod run se) — dobara
  // Kokoro chalana sirf paisa aur waqt zaya karta, seedha render par jao.
  const renderOnly = process.argv.includes('--render-only');
  // VOICE_ONLY: fresh video — timeline/images abhi bane hi nahi (wo voice ki
  // word-timing par depend karte hain). Sirf voice bana kar wapas lao, phir
  // local se timeline/prompts/images chalao, phir doosri dafa --render-only
  // se render ke liye pod rent karo. (2026-08-18 — pehle sirf entrypoint.sh
  // mein server-side ye mode maujood tha, CLI se kabhi expose nahi hua tha.)
  const voiceOnly = process.argv.includes('--voice-only');
  if (renderOnly && voiceOnly) { U.bad('--render-only aur --voice-only dono ek sath nahi de sakte'); process.exit(1); }

  const wd = U.workDir(id);
  if (!voiceOnly) {
    for (const f of ['script.txt', 'timeline.json']) {
      if (!fs.existsSync(U.p(id, f))) { U.bad(`${f} nahi mila — pehle local pipeline se ye stages chala lo`); process.exit(1); }
    }
    if (!fs.existsSync(U.p(id, 'images')) || !fs.readdirSync(U.p(id, 'images')).length) {
      U.bad('images/ khaali hai — pehle local se images stage chala lo'); process.exit(1);
    }
  } else if (!fs.existsSync(U.p(id, 'script.txt'))) {
    U.bad('script.txt nahi mila — pehle script stage chala lo'); process.exit(1);
  }
  if (renderOnly && !fs.existsSync(U.p(id, 'voice', 'voiceover.mp3'))) {
    U.bad('--render-only diya lekin voice/voiceover.mp3 nahi mila'); process.exit(1);
  }

  U.log(`\n== R2 par upload: video spec, script${voiceOnly ? '' : ', timeline, images, thumbnail'}${renderOnly ? ', voice' : ''} ==`);
  R2.upload(id, path.join(U.ROOT, 'videos', videos[0]), `spec/${videos[0]}`);
  R2.upload(id, U.p(id, 'script.txt'), 'script.txt');
  if (!voiceOnly) {
    R2.upload(id, U.p(id, 'timeline.json'), 'timeline.json');
    R2.upload(id, U.p(id, 'images'), 'images');
    if (fs.existsSync(U.p(id, 'thumbnail'))) R2.upload(id, U.p(id, 'thumbnail'), 'thumbnail');
  }
  if (renderOnly) R2.upload(id, U.p(id, 'voice'), 'voice');
  U.ok('upload mukammal');

  const e = U.env();
  const envVars = {
    VIDEO_ID: id,
    VIDEO_SPEC_FILE: videos[0],
    R2_ACCOUNT_ID: e.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: e.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: e.R2_SECRET_ACCESS_KEY, R2_BUCKET: e.R2_BUCKET, R2_ENDPOINT: e.R2_ENDPOINT,
    WHISPER_MODEL: e.WHISPER_MODEL || 'small',
    VOICE_ID: cfg.voice?.id || 'am_adam',
    VOICE_SPEED: String(cfg.voice?.speed || '1.0'),
    ...(renderOnly ? { RENDER_ONLY: '1' } : {}),
    ...(voiceOnly ? { VOICE_ONLY: '1' } : {}),
  };

  let instanceId, waitFn, destroyFn;

  if (provider === 'vast') {
    const gpuName = arg('gpu', 'RTX 5090');
    const minCores = +arg('min-cores', 40);
    const minReliability = +arg('min-reliability', 0.95);
    U.log(`\n== Vast.ai par best offer dhoond raha hun (${gpuName}, ${minCores}+ cores, ${Math.round(minReliability * 100)}%+ reliable) ==`);
    const offer = await Vast.findOffer({ gpuName, minCpuCores: minCores, minReliability });
    U.ok(`offer mila — id ${offer.id}, $${offer.dph_total}/hr, ${offer.cpu_cores_effective || offer.cpu_cores} cores, ${Math.round(offer.reliability2 * 1000) / 10}% reliable`);
    const inst = await Vast.createInstance({ offerId: offer.id, image: imageName, env: envVars });
    instanceId = inst.new_contract || inst.id;
    U.ok(`instance chalu — id: ${instanceId}`);
    waitFn = () => Vast.waitUntilExited(instanceId);
    destroyFn = () => Vast.destroyInstance(instanceId);
  } else {
    const gpuType = arg('gpu', 'NVIDIA A100 80GB PCIe');
    U.log(`\n== RunPod par pod bana raha hun (${gpuType}) ==`);
    const pod = await RunPod.createPod({ name: `story-alpha-${id}`, imageName, gpuTypeIds: [gpuType], env: envVars });
    instanceId = pod.id;
    U.ok(`pod chalu — id: ${instanceId}`);
    waitFn = () => RunPod.waitUntilExited(instanceId);
    destroyFn = () => RunPod.deletePod(instanceId);
  }

  try {
    U.log(`\n== ${voiceOnly ? 'voice' : 'voice+render'} khatam hone ka intezaar (poll ~20s) ==`);
    await waitFn();
    U.ok('kaam khatam');

    if (voiceOnly) {
      U.log(`\n== R2 se wapas download: voice/ ==`);
      R2.download(id, 'voice', U.p(id, 'voice'));
      const voPath = U.p(id, 'voice', 'voiceover.mp3');
      if (!fs.existsSync(voPath) || fs.statSync(voPath).size < 1024) {
        throw new Error(`voice/voiceover.mp3 download ke baad bhi nahi mila (ya khaali hai) — pod ka voice-gen crash hua hoga. Video ID: ${id}`);
      }
      U.ok(`voice mil gayi: work/${id}/voice/ (${(fs.statSync(voPath).size / 1048576).toFixed(1)} MB)`);
    } else {
      U.log(`\n== R2 se wapas download: final.mp4, voice/, captions/ ==`);
      R2.download(id, 'final.mp4', wd);
      R2.download(id, 'voice', U.p(id, 'voice'));
      R2.download(id, 'captions', U.p(id, 'captions'));
      // ASLI BUG (2026-08-17): pehle ye line unconditionally "✓ mil gayi" print
      // karti thi chahe download kuch laaya ho ya nahi (rclone copy ek missing
      // remote file par chup-chaap kuch nahi karta, error nahi deta) — pod ka
      // render crash ho gaya tha (concat ke baad, particles/captions ya final
      // mux mein) lekin waitUntilExited sirf "exited" status dekhta hai, exit
      // CODE nahi — is liye poora flow "success" dikha, jab k final.mp4 kabhi
      // bana hi nahi. Ab download ke baad file ka wajood + size khud check.
      const finalPath = path.join(wd, 'final.mp4');
      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) {
        throw new Error(`final.mp4 download ke baad bhi nahi mila (ya khaali hai) — pod ka render crash hua hoga, R2 par kabhi upload hi nahi hui. Video ID: ${id}`);
      }
      U.ok(`final.mp4 mil gayi: work/${id}/final.mp4 (${(fs.statSync(finalPath).size / 1048576).toFixed(1)} MB)`);
    }
  } finally {
    U.log(`\n== instance DELETE kar raha hun (paisa bachane ke liye — sirf stop nahi) ==`);
    await destroyFn().catch(err => U.warn(`delete fail: ${err.message} — dashboard se khud check kar lo`));
    U.ok('instance terminate ho gaya');
  }
})().catch(e => { U.bad(e.message); process.exit(1); });
