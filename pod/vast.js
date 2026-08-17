// ============================================================
//  Vast.ai REST API — offer dhoondo, instance banao, status dekho, khatam karo
//
//  ASLI GOTCHA: docs.vast.ai ke examples (PUT /bundles/ with {q:{...}},
//  PUT /asks/{id}/) test karne par 404/400 dete hain — docs stale hain.
//  Live API test kar ke ye SAHI shape maloom hui (2026-08-17):
//    search:  POST /api/v0/bundles          body = query object SEEDHA (no "q" wrapper)
//    create:  PUT  /api/v0/asks/{offerId}/
//    status:  GET  /api/v0/instances/{id}/   (v1 sirf LIST ke liye hai, single-id GET v0 par hai)
//    destroy: DELETE /api/v0/instances/{id}/
//
//  ASLI GOTCHA #2 (RunPod par bhi yehi mila tha): "stop" sirf compute rok ta
//  hai, DISK abhi bhi attached rehti hai aur billing chalti rehti hai.
//  Is liye HAMESHA DELETE (destroy) karo, kabhi sirf "stop" nahi.
// ============================================================
const U = require('../lib/util.js');

const BASE = 'https://console.vast.ai/api/v0';

function key() {
  const e = U.env();
  if (!e.VAST_API_KEY) throw new Error('.env mein VAST_API_KEY nahi mila');
  return e.VAST_API_KEY;
}

async function req(method, pathSuffix, body) {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || json.success === false) throw new Error(`Vast.ai API ${method} ${pathSuffix} — ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// GPU naam + minimum reliability se best (sabse sasta) offer dhoondo.
// Min CPU cores ka koi seedha filter field nahi (verify kiya, sirf gpu_name/
// num_gpus/reliability2/rentable jaise ops maane) — is liye result mein se
// khud filter karte hain.
// ASLI BUG (2026-08-17): "reliability2" score achi hone ke bawajood (99%+)
// do consecutive instances "deverified" hosts par lagin — pehli ka
// actual_status hamesha null raha (upar wala fix), doosri "Creating..."
// mein hi atki rahi (Vast dashboard se dekha, "Status: not running").
// `verification` field mein "verified"/"unverified"/"deverified" hoti hai —
// "deverified" ka matlab Vast khud ne is host ko failed-verification maara
// hai (hardware/uptime issue). Ab default mein explicitly bahar rakha,
// warna sabse sasta offer almost hamesha yehi nikalta hai.
async function findOffer({ gpuName, minCpuCores = 40, minReliability = 0.95, maxGpuCount = 1, excludeDeverified = true }) {
  const res = await req('POST', '/bundles', {
    gpu_name: { eq: gpuName },
    num_gpus: { lte: maxGpuCount },
    reliability2: { gte: minReliability },
    rentable: { eq: true },
    order: [['dph_total', 'asc']],
    type: 'on-demand',
    limit: 50,
  });
  let offers = (res.offers || []).filter(o => (o.cpu_cores_effective || o.cpu_cores || 0) >= minCpuCores);
  if (excludeDeverified) offers = offers.filter(o => o.verification !== 'deverified');
  if (!offers.length) throw new Error(`koi offer nahi mila (${gpuName}, ${minCpuCores}+ cores, ${minReliability * 100}%+ reliable${excludeDeverified ? ', deverified hosts excluded' : ''})`);
  return offers[0]; // sabse sasta jo shart poori kare
}

// env: plain object {KEY: "value"} — Vast.ai khud "-e KEY=value" format maangta hai
function envToDockerFlags(env) {
  return Object.entries(env).map(([k, v]) => `-e ${k}=${JSON.stringify(String(v))}`).join(' ');
}

async function createInstance({ offerId, image, disk = 60, env = {} }) {
  return req('PUT', `/asks/${offerId}/`, {
    image,
    disk,
    env: envToDockerFlags(env),
    // ASLI BUG (pehla test run): runtype "ssh" Vast.ai APNA entrypoint laga
    // deta hai (SSH setup ke liye) aur image ka apna ENTRYPOINT (entrypoint.sh)
    // KABHI nahi chalta — instance bas SSH le kar khaali baitha rehta,
    // paisa jalta rehta, kaam kabhi shuru na hota. "args" runtype image ka
    // ENTRYPOINT bark rakhta hai, is liye entrypoint.sh khud-ba-khud chalta hai.
    runtype: 'args',
  });
}

async function getInstance(id) { return req('GET', `/instances/${id}/`); }
async function destroyInstance(id) { return req('DELETE', `/instances/${id}/`); }

async function waitUntilExited(id, { intervalMs = 20000, timeoutMs = 90 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const res = await getInstance(id);
    // ASLI BUG (2026-08-17): kuch hosts par `actual_status` hamesha null
    // aata hai (confirmed real case — instance genuinely "running" tha per
    // `cur_state`, lekin `actual_status` kabhi kuch bhi nahi bharta) — is
    // liye poll loop hamesha "(booting)" print karta rehta, chahe instance
    // kabhi "exited" ho bhi jaye — 90 min timeout tak kabhi pata hi nahi
    // chalta. `cur_state` fallback ke taur par istemal karo jab `actual_status`
    // maujood na ho.
    const status = res?.instances?.actual_status || res?.instances?.cur_state;
    U.log(`   instance ${id}: ${status ?? '(booting)'}`);
    if (status && /exited/i.test(status)) return res;
    if (status && /unknown|error/i.test(status)) throw new Error(`instance ${id} status "${status}" — kuch ghalat hua, dashboard check karo`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`instance ${id} ${timeoutMs / 60000} min mein khatam nahi hua — khud check karo`);
}

module.exports = { findOffer, createInstance, getInstance, destroyInstance, waitUntilExited };
