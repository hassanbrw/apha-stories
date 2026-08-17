#!/bin/bash
# ============================================================
#  POD ENTRYPOINT -- R2 se download, voice+render, R2 par upload
#
#  Zaroori env vars (pod launch ke waqt RunPod secrets se aate hain):
#    VIDEO_ID              — konsa video (work/<id>/ folder ka naam)
#    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
#    VOICE_ID               — (optional) Kokoro voice preset, default "am_adam"
#    VOICE_SPEED             — (optional) default "1.0"
#    WHISPER_MODEL          — (optional) default "small"
#    VOICE_ONLY             — (optional) "1" ho to sirf voice bana kar wapas
#                              upload karo, render bilkul mat chalao (render
#                              CPU-bound hai, GPU se koi faida nahi — is liye
#                              jab sirf voice chahiye ho to render skip kar ke
#                              pod jaldi/sasta khatam hota hai)
#    WAIT_FOR_IMAGES        — (optional) "1" ho to voice ke baad pod KHATAM
#                              nahi hota — R2 par ek "IMAGES_READY" marker file
#                              ka intezaar karta hai (images is beech mein LOCAL
#                              machine par bantay hain, kyunki wo sirf Gemini
#                              browser login se chalte hain, pod par nahi ho
#                              saktay). Marker milte hi timeline/images download
#                              kar ke render khud shuru kar deta hai — isi pod
#                              rental mein, dobara rent karne ki zaroorat nahi.
#                              Intezaar max 90 min, phir error (paisa na jaltay).
# ============================================================
set -euo pipefail

if [ -z "${VIDEO_ID:-}" ] || [ -z "${VIDEO_SPEC_FILE:-}" ]; then
  echo "ERROR: VIDEO_ID ya VIDEO_SPEC_FILE env var set nahi hai — kaunsa video banana hai?"
  exit 1
fi

WORKDIR="/app/work/${VIDEO_ID}"
mkdir -p "$WORKDIR"

# ---------- rclone config (R2, S3-compatible) ----------
RCLONE_CONF="/tmp/rclone.conf"
cat > "$RCLONE_CONF" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
EOF
RCLONE="rclone --config $RCLONE_CONF --s3-no-check-bucket"

echo "== R2 se script.txt download ho raha hai =="
mkdir -p /app/videos
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/script.txt" "$WORKDIR/"
if [ "${VOICE_ONLY:-0}" != "1" ] && [ "${WAIT_FOR_IMAGES:-0}" != "1" ]; then
  echo "== R2 se video spec + images/ + timeline.json bhi download ho raha hai =="
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/spec/${VIDEO_SPEC_FILE}" "/app/videos/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/timeline.json" "$WORKDIR/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/images/" "$WORKDIR/images/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/thumbnail/" "$WORKDIR/thumbnail/" || true
fi

echo "== VOICE (Kokoro, parallel, voice=${VOICE_ID:-am_adam}) ${WHISPER_MODEL:-small} =="
python3 /app/pod/kokoro_tts_pod.py "$WORKDIR" "${VOICE_ID:-am_adam}" "${VOICE_SPEED:-1.0}" "${WHISPER_MODEL:-small}"

if [ "${VOICE_ONLY:-0}" = "1" ]; then
  echo "== VOICE_ONLY=1 — render skip, sirf voice/ R2 par upload ho raha hai =="
  $RCLONE copy "$WORKDIR/voice/" "r2:${R2_BUCKET}/${VIDEO_ID}/voice/"
  echo "== KHATAM — voice R2 par ready hai: ${VIDEO_ID}/voice/ =="
  exit 0
fi

if [ "${WAIT_FOR_IMAGES:-0}" = "1" ]; then
  echo "== voice R2 par upload ho raha hai (images ka wait shuru karne se pehle) =="
  $RCLONE copy "$WORKDIR/voice/" "r2:${R2_BUCKET}/${VIDEO_ID}/voice/"
  echo "== ab IMAGES_READY marker ka intezaar (local machine par images ban rahi hain) =="
  WAITED=0
  MAXWAIT=5400   # 90 min
  until $RCLONE lsf "r2:${R2_BUCKET}/${VIDEO_ID}/IMAGES_READY" 2>/dev/null | grep -q IMAGES_READY; do
    sleep 20
    WAITED=$((WAITED + 20))
    if [ "$WAITED" -ge "$MAXWAIT" ]; then
      echo "ERROR: 90 min tak IMAGES_READY marker nahi mila — images shayad fail ho gayin. Ruk raha hun."
      exit 1
    fi
    if [ $((WAITED % 100)) -eq 0 ]; then echo "   ...${WAITED}s se intezaar mein"; fi
  done
  echo "== IMAGES_READY mil gaya — spec + images/ + timeline.json download ho rahe hain =="
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/spec/${VIDEO_SPEC_FILE}" "/app/videos/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/timeline.json" "$WORKDIR/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/images/" "$WORKDIR/images/"
  $RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/thumbnail/" "$WORKDIR/thumbnail/" || true
fi

echo "== RENDER (ffmpeg clips + overlay + mux) =="
cd /app
# config.json ka concurrency.render local machine (12 cores) ke liye tuned hai
# (=6) — pod par jitne bhi cores rent hue hain unka use karo, warna zyadatar
# rented cores render ke waqt khaali baithe rahenge. Pehle 32 par cap tha
# (bina real pod test ke, sirf andaza — 384-core pod par isse zyadatar cores
# khaali reh jate). 2026-08-17: stages/9-render.js ab har parallel ffmpeg clip
# ko explicit -threads deta hai (CONC ke hisaab se, Kokoro workers wale
# thread-oversubscription fix jaisa) — is liye CONC ab bare core count par
# bhi cores ke aapas mein larne ka khatra nahi, cap 128 tak bara diya.
PODCORES=$(nproc)
export RENDER_CONC=$(( PODCORES < 128 ? PODCORES : 128 ))
echo "   RENDER_CONC=${RENDER_CONC} (pod cores: ${PODCORES})"
node run.js --video="${VIDEO_ID}" --only=render

echo "== R2 par final.mp4 + voice/ + captions/ upload ho raha hai =="
$RCLONE copy "$WORKDIR/final.mp4" "r2:${R2_BUCKET}/${VIDEO_ID}/"
$RCLONE copy "$WORKDIR/voice/" "r2:${R2_BUCKET}/${VIDEO_ID}/voice/"
$RCLONE copy "$WORKDIR/captions/" "r2:${R2_BUCKET}/${VIDEO_ID}/captions/" || true

echo "== KHATAM — final.mp4 R2 par ready hai: ${VIDEO_ID}/final.mp4 =="
