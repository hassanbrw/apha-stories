// ============================================================
//  POD SEND IMAGES — jo pod pod-start-voice.js se chhoda gaya tha (WAIT_FOR_
//  IMAGES=1, images ka intezaar kar raha hai) usay ab timeline/images bhejo,
//  render karwao, final.mp4 le kar aao, TAB instance delete karo.
//
//  istemal (pod-start-voice.js ke turant baad, local timeline/prompts/
//  keywords/images stages chalane ke baad):
//    node pod/pod-send-images.js --video="<id>"
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
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
  const wd = U.workDir(id);

  const sessionFile = U.p(id, '.pod-session.json');
  if (!fs.existsSync(sessionFile)) {
    U.bad('.pod-session.json nahi mila — pehle node pod/pod-start-voice.js chalao');
    process.exit(1);
  }
  const { provider, instanceId } = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));

  for (const f of ['timeline.json']) {
    if (!fs.existsSync(U.p(id, f))) { U.bad(`${f} nahi mila — pehle local timeline stage chalao`); process.exit(1); }
  }
  if (!fs.existsSync(U.p(id, 'images')) || !fs.readdirSync(U.p(id, 'images')).length) {
    U.bad('images/ khaali hai — pehle local se images stage chalao'); process.exit(1);
  }

  U.log(`\n== R2 par upload: spec, timeline, images, thumbnail ==`);
  R2.upload(id, path.join(U.ROOT, 'videos', videos[0]), `spec/${videos[0]}`);
  R2.upload(id, U.p(id, 'timeline.json'), 'timeline.json');
  R2.upload(id, U.p(id, 'images'), 'images');
  if (fs.existsSync(U.p(id, 'thumbnail'))) R2.upload(id, U.p(id, 'thumbnail'), 'thumbnail');
  U.ok('upload mukammal');

  U.log(`\n== IMAGES_READY marker bhej raha hun (pod ${instanceId} ab render shuru karega) ==`);
  const markerFile = path.join(os.tmpdir(), `IMAGES_READY-${id}`);
  fs.writeFileSync(markerFile, 'ready');
  R2.upload(id, markerFile, 'IMAGES_READY');
  fs.rmSync(markerFile, { force: true });
  U.ok('marker bheja gaya');

  const waitFn = () => provider === 'vast' ? Vast.waitUntilExited(instanceId) : RunPod.waitUntilExited(instanceId);
  const destroyFn = () => provider === 'vast' ? Vast.destroyInstance(instanceId) : RunPod.deletePod(instanceId);

  try {
    U.log(`\n== render khatam hone ka intezaar (poll ~20s) ==`);
    await waitFn();
    U.ok('render khatam');

    U.log(`\n== R2 se wapas download: final.mp4, captions/ ==`);
    R2.download(id, 'final.mp4', wd);
    R2.download(id, 'captions', U.p(id, 'captions'));
    U.ok(`final.mp4 mil gayi: work/${id}/final.mp4`);
  } finally {
    U.log(`\n== instance DELETE kar raha hun (paisa bachane ke liye — sirf stop nahi) ==`);
    await destroyFn().catch(err => U.warn(`delete fail: ${err.message} — dashboard se khud check kar lo`));
    fs.rmSync(sessionFile, { force: true });
    U.ok('instance terminate ho gaya');
  }
})().catch(e => { U.bad(e.message); process.exit(1); });
