// ============================================================
//  POD START (VOICE) — pod rent karo, Chatterbox+Antoni voice banwao, phir
//  pod ko ZINDA CHHOD DO (destroy NAHI karte) — wo IMAGES_READY marker ka
//  intezaar khud entrypoint.sh mein karta hai (WAIT_FOR_IMAGES=1).
//
//  istemal:
//    node pod/pod-start-voice.js --video="<id>"
//
//  Is ke baad: local pipeline chalao (timeline, prompts, keywords, images —
//  jo Gemini browser login maangte hain, is liye pod par nahi ho saktay).
//  Phir: node pod/pod-send-images.js --video="<id>"  (isi pod ko images
//  bhejta hai, render karwata hai, final.mp4 laata hai, TAB instance delete
//  karta hai).
// ============================================================
const fs = require('fs');
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
  const id = spec.id;
  const provider = arg('provider', 'vast');
  const imageName = U.env().POD_IMAGE_NAME;
  if (!imageName) { U.bad('.env mein POD_IMAGE_NAME nahi mila'); process.exit(1); }
  if (!fs.existsSync(U.p(id, 'script.txt'))) { U.bad('script.txt nahi mila — pehle local script stage chalao'); process.exit(1); }

  // ASLI BUG (2026-08-17): pichli video ka voice/ R2 par pada reh gaya tha —
  // is script ka poll sirf "voice/voiceover.mp3 maujood hai?" dekhta hai, aur
  // wo PURANI (corrupted-script se bani) file dekh kar foran "mil gayi" keh
  // deta tha, bina pod ke naya kuch banaye. Ab har naye run se pehle purana
  // voice/ R2 se poora mita dete hain, taake stale data kabhi dobara galat
  // "done" na lage.
  U.log(`\n== R2 par purana voice/ + IMAGES_READY marker (agar koi ho) saaf kar raha hun ==`);
  R2.remove(id, 'voice');
  R2.remove(id, 'IMAGES_READY');

  U.log(`\n== R2 par upload: script.txt ==`);
  R2.upload(id, U.p(id, 'script.txt'), 'script.txt');
  U.ok('upload mukammal');

  const e = U.env();
  const envVars = {
    VIDEO_ID: id,
    VIDEO_SPEC_FILE: videos[0],
    R2_ACCOUNT_ID: e.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: e.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: e.R2_SECRET_ACCESS_KEY, R2_BUCKET: e.R2_BUCKET, R2_ENDPOINT: e.R2_ENDPOINT,
    WHISPER_MODEL: e.WHISPER_MODEL || 'small',
    WAIT_FOR_IMAGES: '1',
    ...(e.VOICE_REF_AUDIO ? { VOICE_REF_AUDIO: e.VOICE_REF_AUDIO } : {}),
  };

  let instanceId;
  if (provider === 'vast') {
    const gpuName = arg('gpu', 'RTX 5090');
    const minCores = +arg('min-cores', 40);
    const minReliability = +arg('min-reliability', 0.95);
    U.log(`\n== Vast.ai par best offer dhoond raha hun (${gpuName}, ${minCores}+ cores, ${Math.round(minReliability * 100)}%+ reliable) ==`);
    const offer = await Vast.findOffer({ gpuName, minCpuCores: minCores, minReliability });
    U.ok(`offer mila — id ${offer.id}, $${offer.dph_total}/hr, ${offer.cpu_cores_effective || offer.cpu_cores} cores, ${Math.round(offer.reliability2 * 1000) / 10}% reliable`);
    const inst = await Vast.createInstance({ offerId: offer.id, image: imageName, env: envVars });
    instanceId = inst.new_contract || inst.id;
  } else {
    const gpuType = arg('gpu', 'NVIDIA A100 80GB PCIe');
    U.log(`\n== RunPod par pod bana raha hun (${gpuType}) ==`);
    const pod = await RunPod.createPod({ name: `story-alpha-${id}`, imageName, gpuTypeIds: [gpuType], env: envVars });
    instanceId = pod.id;
  }
  U.ok(`instance chalu — id: ${instanceId}`);

  fs.writeFileSync(U.p(id, '.pod-session.json'), JSON.stringify({ provider, instanceId }, null, 2));

  const destroyFn = () => provider === 'vast' ? Vast.destroyInstance(instanceId) : RunPod.deletePod(instanceId);

  U.log(`\n== voice (Chatterbox, Antoni) ka intezaar (poll ~20s) ==`);
  const t0 = Date.now();
  const timeoutMs = 45 * 60 * 1000; // Chatterbox itself kabhi 45 min na le, safety cap
  while (!R2.exists(id, 'voice/voiceover.mp3')) {
    if (Date.now() - t0 > timeoutMs) {
      U.bad('45 min mein voice nahi bani — kuch ghalat hua, instance delete kar raha hun (paisa na jaltay)');
      await destroyFn().catch(err => U.warn(`delete fail: ${err.message} — dashboard se khud check kar lo`));
      fs.rmSync(U.p(id, '.pod-session.json'), { force: true });
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  U.ok('voice R2 par mil gayi');

  U.log(`\n== voice/ wapas local par download ho raha hai ==`);
  R2.download(id, 'voice', U.p(id, 'voice'));
  U.ok(`voice mil gayi: work/${id}/voice/`);

  U.log(`\n== instance ZINDA hai (id: ${instanceId}) — images ka intezaar kar raha hai ==`);
  U.log(`   agla step: local pipeline chalao (timeline se images tak)`);
  U.log(`   phir: node pod/pod-send-images.js --video="${id}"`);
})().catch(e => { U.bad(e.message); process.exit(1); });
