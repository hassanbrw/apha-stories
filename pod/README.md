# Remote voice + render (Vast.ai/RunPod + Kokoro + R2)

Script generation, image prompts, and images (Gemini) stay **local** — they
either need a real browser login or gain nothing from a GPU. Only **voice**
(Kokoro, parallel across all pod cores) and **render** (ffmpeg) run on the
rented instance.

Chatterbox (voice cloning) was tried and removed (2026-08-17) — the cloned
voice came out ~3x too fast and clarity/cloning quality was bad on two
separate real pod runs. Kokoro (the same engine used locally, proven across
several videos) is back as the only voice engine — the only thing that
changed is *where* it runs: `pod/kokoro_tts_pod.py` uses
`multiprocessing.Pool` across all the pod's cores, something Windows can't
do reliably here (a sandboxed-process OS restriction), so this alone is a
large speedup over the local sequential run.

Default provider is **Vast.ai** (cheaper). RunPod stays supported as a
fallback (`--provider=runpod`).

## One-time setup

1. **Fill in `.env`**: `R2_*` vars (already have these), `VAST_API_KEY`
   (from https://cloud.vast.ai/account/), `POD_IMAGE_NAME` (see step 2).
2. **Push this repo to GitHub.** `.github/workflows/build-pod-image.yml`
   builds `pod/Dockerfile` and pushes it to `ghcr.io/<you>/story-alpha-pod:latest`
   automatically on every push to `main`. Put that exact string in
   `POD_IMAGE_NAME` in `.env`.
3. Make the GHCR package **public** (GitHub repo → Packages → package
   settings) so Vast.ai/RunPod can pull it without extra auth.

## Running a video (single rental, voice + render)

Render needs `timeline.json` + `images/`, but both only exist *after* voice
(timeline is built from voice's word-by-word timing). So a single pod
rental spans the whole thing, idling cheaply while images get made locally
in between — not two separate rentals:

```bash
# 1) local: script + thumbnail only
node run.js --video="<id>" --only=script
# ...verify/edit script.txt like always...
node run.js --video="<id>" --only=thumbnail

# 2) rent a pod, generate voice, leave the pod running (waiting)
node pod/pod-start-voice.js --video="<id>"
#   or explicitly:
node pod/pod-start-voice.js --video="<id>" --provider=vast --gpu="RTX 4090" --min-cores=200

# 3) local: timeline -> prompts -> images (needs the voice from step 2)
node run.js --video="<id>" --only=timeline,prompts,images

# 4) send images to the still-waiting pod; it renders and exits; instance
#    gets deleted once final.mp4 is downloaded
node pod/pod-send-images.js --video="<id>"
```

`pod-start-voice.js` writes `work/<id>/.pod-session.json` so
`pod-send-images.js` knows which instance to signal later.

`pod/run-on-pod.js` (the older all-in-one script) still works for the case
where images/timeline are *already* prepared locally ahead of time — it also
has a `--voice-only` mode. The two-script flow above is the primary path for
a fresh video.

## Notes

- R2 token here is bucket-scoped (no ListBuckets) — `pod/r2.js` handles this
  (`--s3-no-check-bucket`).
- **`rclone copy` treats its destination as a directory, always** — renaming
  a file during upload (source basename ≠ target name) silently nests it
  instead of placing it at the exact path. Use `R2.uploadAs()` (`rclone
  copyto`) for any upload that renames; `R2.upload()` (`rclone copy`) only
  for basename-preserving uploads (whole directories, or same-name files).
  This bug caused a real ~30-restart failure loop before being caught.
- **`R2.remove(id, 'voice')` + `R2.remove(id, 'IMAGES_READY')` run at the
  start of every `pod-start-voice.js` call** — without this, a leftover file
  from an earlier/aborted run on the same video ID gets mistaken for a fresh
  result and the pod reports "done" in seconds having done nothing.
- Vast.ai offer search: `--gpu` (exact GPU name match), `--min-cores`
  (default 40), `--min-reliability` (default 0.95) — picks the *cheapest*
  offer meeting all three.
- Vast.ai appears to auto-restart the container on a nonzero exit — a bug
  that crashes the entrypoint will loop silently (confirmed: 30 consecutive
  failures once) until the 90-minute wait timeout. Watch real runs via the
  logs endpoint, don't just trust "still running."
- **Billing discipline**: always fully delete instances (never just stop —
  a stopped-but-not-deleted instance keeps billing for its disk). Glance at
  the provider's billing page after real runs regardless.
