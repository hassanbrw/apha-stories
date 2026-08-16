// ============================================================
//  RunPod REST API — pod banao, status dekho, band/khatam karo
//  Docs verify kiye: POST /v1/pods, GET /v1/pods/{id}, POST /v1/pods/{id}/stop,
//  DELETE /v1/pods/{id}
// ============================================================
const U = require('../lib/util.js');

const BASE = 'https://rest.runpod.io/v1';

function key() {
  const e = U.env();
  if (!e.RUNPOD_API_KEY) throw new Error('.env mein RUNPOD_API_KEY nahi mila');
  return e.RUNPOD_API_KEY;
}

async function req(method, pathSuffix, body) {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`RunPod API ${method} ${pathSuffix} — ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// imageName = Docker Hub ya GHCR par push ki hui image (pod/Dockerfile se banti hai)
async function createPod({ name, imageName, gpuTypeIds, env, containerDiskInGb = 50 }) {
  return req('POST', '/pods', {
    name, imageName, computeType: 'GPU', gpuCount: 1, gpuTypeIds,
    containerDiskInGb, cloudType: 'SECURE', env,
  });
}
async function getPod(id) { return req('GET', `/pods/${id}`); }
async function stopPod(id) { return req('POST', `/pods/${id}/stop`); }
async function deletePod(id) { return req('DELETE', `/pods/${id}`); }

// pod ka apna kaam (entrypoint.sh) khatam ho jaye to container "exited" ho
// jata hai — status poll karte hain jab tak wo state na aa jaye.
async function waitUntilExited(id, { intervalMs = 20000, timeoutMs = 3 * 60 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const pod = await getPod(id);
    const status = pod?.desiredStatus || pod?.status;
    U.log(`   pod ${id}: ${status}`);
    if (status && /exited|terminated|stopped/i.test(status)) return pod;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`pod ${id} ${timeoutMs / 60000} min mein khatam nahi hua — khud check karo`);
}

module.exports = { createPod, getPod, stopPod, deletePod, waitUntilExited };
