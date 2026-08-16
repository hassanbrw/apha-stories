# Remote voice + render (Vast.ai/RunPod + Chatterbox + R2)

Script generation, image prompts, and images (Gemini) stay **local** — they
either need a real browser login or gain nothing from a GPU. Only **voice**
(Chatterbox, GPU) and **render** (ffmpeg) run on the rented instance.

Default provider is **Vast.ai** (cheaper — found a 1x RTX 5090 + 96 CPU cores
for $0.727/hr, vs RunPod's best equivalent match at $1.39/hr). RunPod stays
supported as a fallback (`--provider=runpod`).

## One-time setup

1. **Fill in `.env`**: `R2_*` vars (already have these), `VAST_API_KEY`
   (from https://cloud.vast.ai/account/), `POD_IMAGE_NAME` (see step 2).
2. **Push this repo to GitHub.** `.github/workflows/build-pod-image.yml`
   builds `pod/Dockerfile` and pushes it to `ghcr.io/<you>/story-alpha-pod:latest`
   automatically on every push to `main`. Put that exact string in
   `POD_IMAGE_NAME` in `.env`.
3. Make the GHCR package **public** (GitHub repo → Packages → package
   settings) so Vast.ai/RunPod can pull it without extra auth — simplest for now.

## Running a video

```bash
# 1) normal local pipeline, but stop before voice
node run.js --video="<id>" --only=script
# ...verify/edit script.txt like always...
node run.js --video="<id>" --from=1.7 --only=thumbnail,timeline,prompts,keywords,images,avatar,stock

# 2) hand off voice + render to the rented instance
node pod/run-on-pod.js --video="<id>"
#   or explicitly:
node pod/run-on-pod.js --video="<id>" --provider=vast --gpu="RTX 5090" --min-cores=90
node pod/run-on-pod.js --video="<id>" --provider=runpod --gpu="NVIDIA A100 80GB PCIe"
```

That command: uploads script+images+timeline to R2 → finds the cheapest
matching offer and rents it (Vast.ai) or creates a pod (RunPod) → waits for
voice+render to finish → downloads `final.mp4` back to `work/<id>/` →
**deletes the instance** (not just stops it — a stopped-but-not-deleted
instance keeps billing for its disk, which is exactly what drained $7 from
the RunPod account earlier this session. Always full delete, never just stop).

## Notes

- R2 token here is bucket-scoped (no ListBuckets) — `pod/r2.js` already
  handles this (`--s3-no-check-bucket`).
- Vast.ai offer search: `--gpu` (exact GPU name match), `--min-cores`
  (default 40), `--min-reliability` (default 0.95) — picks the *cheapest*
  offer meeting all three.
- Voice cloning: set `VOICE_REF_AUDIO` in `.env` to a R2 path (e.g.
  `refs/antoni.wav`) to clone that voice instead of Chatterbox's default.
- **Not yet tested end-to-end on a real instance** — the code is written
  against the real documented APIs and syntax-checked, but the actual GPU
  run (Chatterbox timing, render speed with 90+ cores) needs a real rental
  to verify.
- **Billing discipline**: after every real run, glance at the provider's
  billing/usage page once — don't rely solely on the auto-delete working
  perfectly every time.
