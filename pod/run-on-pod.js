// ============================================================
//  RUN ON POD — poora remote voice+render workflow, ek command se
//
//  istemal:
//    node pod/run-on-pod.js --video="<id>"                          (Vast.ai, default)
//    node pod/run-on-pod.js --video="<id>" --provider=runpod --gpu="NVIDIA A100 80GB PCIe"
//    node pod/run-on-pod.js --video="<id>" --provider=vast --gpu="RTX 5090" --min-cores=90
//
//  1) local se R2 par: script.txt, timeline.json, images/, thumbnail/
//  2) GPU instance banao (Docker image se — pehle GitHub Actions se
//     build+push honi chahiye, pod/README.md dekho)
//  3) instance khud R2 se download karta hai, voice (Chatterbox) + render
//     karta hai, phir R2 par upload kar deta hai (entrypoint.sh dekho)
//  4) jab kaam khatam ho (container exit), R2 se final.mp4 + voice/ +
//     captions/ wapas local par download karo
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
  const id = spec.id;
  const provider = arg('provider', 'vast'); // user ka faisla: Vast.ai sasta nikla RunPod se
  const imageName = U.env().POD_IMAGE_NAME;
  if (!imageName) { U.bad('.env mein POD_IMAGE_NAME nahi mila (Docker image jo push ki gayi hai)'); process.exit(1); }

  const wd = U.workDir(id);
  for (const f of ['script.txt', 'timeline.json']) {
    if (!fs.existsSync(U.p(id, f))) { U.bad(`${f} nahi mila — pehle local pipeline se ye stages chala lo`); process.exit(1); }
  }
  if (!fs.existsSync(U.p(id, 'images')) || !fs.readdirSync(U.p(id, 'images')).length) {
    U.bad('images/ khaali hai — pehle local se images stage chala lo'); process.exit(1);
  }

  U.log(`\n== R2 par upload: video spec, script, timeline, images, thumbnail ==`);
  R2.upload(id, path.join(U.ROOT, 'videos', videos[0]), `spec/${videos[0]}`);
  R2.upload(id, U.p(id, 'script.txt'), 'script.txt');
  R2.upload(id, U.p(id, 'timeline.json'), 'timeline.json');
  R2.upload(id, U.p(id, 'images'), 'images');
  if (fs.existsSync(U.p(id, 'thumbnail'))) R2.upload(id, U.p(id, 'thumbnail'), 'thumbnail');
  U.ok('upload mukammal');

  const e = U.env();
  const envVars = {
    VIDEO_ID: id,
    VIDEO_SPEC_FILE: videos[0],
    R2_ACCOUNT_ID: e.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: e.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: e.R2_SECRET_ACCESS_KEY, R2_BUCKET: e.R2_BUCKET, R2_ENDPOINT: e.R2_ENDPOINT,
    WHISPER_MODEL: e.WHISPER_MODEL || 'small',
    ...(e.VOICE_REF_AUDIO ? { VOICE_REF_AUDIO: e.VOICE_REF_AUDIO } : {}),
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
    U.log(`\n== voice+render khatam hone ka intezaar (poll ~20s) ==`);
    await waitFn();
    U.ok('kaam khatam');

    U.log(`\n== R2 se wapas download: final.mp4, voice/, captions/ ==`);
    R2.download(id, 'final.mp4', wd);
    R2.download(id, 'voice', U.p(id, 'voice'));
    R2.download(id, 'captions', U.p(id, 'captions'));
    U.ok(`final.mp4 mil gayi: work/${id}/final.mp4`);
  } finally {
    U.log(`\n== instance DELETE kar raha hun (paisa bachane ke liye — sirf stop nahi) ==`);
    await destroyFn().catch(err => U.warn(`delete fail: ${err.message} — dashboard se khud check kar lo`));
    U.ok('instance terminate ho gaya');
  }
})().catch(e => { U.bad(e.message); process.exit(1); });
