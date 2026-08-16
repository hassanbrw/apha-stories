// Lambe avatar slots ko chhote tukron mein torne ka ek hi tareeqa —
// avatar-fallback-images.js aur 9-render.js dono yahi istemal karte hain,
// warna banayi hui images aur dhoondhi jane wali files match nahi hotin.
const tagOf = (a, b) => `${String(Math.floor(a)).padStart(5, '0')}_${String(Math.floor(b)).padStart(5, '0')}`;

// 4 second ke aas paas tukre (aakhri tukra 2.5s se chhota na ho)
function subSlots(s, target = 4) {
  if (s.dur <= target * 1.5) return [{ start: s.start, end: s.end, dur: s.dur, tag: tagOf(s.start, s.end) }];
  const n = Math.max(2, Math.round(s.dur / target));
  const step = s.dur / n;
  return Array.from({ length: n }, (_, k) => {
    const a = s.start + k * step, b = k === n - 1 ? s.end : s.start + (k + 1) * step;
    return { start: a, end: b, dur: b - a, tag: tagOf(a, b) };
  });
}
module.exports = { subSlots, tagOf };
