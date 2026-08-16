#!/bin/bash
# ============================================================
#  POD ENTRYPOINT — R2 se download, voice+render, R2 par upload
#
#  Zaroori env vars (pod launch ke waqt RunPod secrets se aate hain):
#    VIDEO_ID              — konsa video (work/<id>/ folder ka naam)
#    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
#    VOICE_REF_AUDIO        — (optional) cloning ke liye reference .wav ka R2 path
#    WHISPER_MODEL          — (optional) default "small"
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

echo "== R2 se video spec + script.txt + images/ + timeline.json download ho raha hai =="
mkdir -p /app/videos
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/spec/${VIDEO_SPEC_FILE}" "/app/videos/"
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/script.txt" "$WORKDIR/"
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/timeline.json" "$WORKDIR/"
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/images/" "$WORKDIR/images/"
$RCLONE copy "r2:${R2_BUCKET}/${VIDEO_ID}/thumbnail/" "$WORKDIR/thumbnail/" || true

REF_ARG=""
if [ -n "${VOICE_REF_AUDIO:-}" ]; then
  $RCLONE copy "r2:${R2_BUCKET}/${VOICE_REF_AUDIO}" /tmp/voice_ref/
  REF_ARG="/tmp/voice_ref/$(basename "$VOICE_REF_AUDIO")"
fi

echo "== VOICE (Chatterbox, GPU) ${WHISPER_MODEL:-small} =="
python3 /app/pod/chatterbox_tts.py "$WORKDIR" "${REF_ARG}" "${WHISPER_MODEL:-small}"

echo "== RENDER (ffmpeg clips + overlay + mux) =="
cd /app
# config.json ka concurrency.render local machine (12 cores) ke liye tuned hai
# (=6) — pod par jitne bhi cores rent hue hain unka use karo, warna zyadatar
# rented cores render ke waqt khaali baithe rahenge. 32 par cap kiya hai
# (diminishing returns aur ffmpeg process-spawn overhead se bachne ke liye).
PODCORES=$(nproc)
export RENDER_CONC=$(( PODCORES < 32 ? PODCORES : 32 ))
echo "   RENDER_CONC=${RENDER_CONC} (pod cores: ${PODCORES})"
node run.js --video="${VIDEO_ID}" --only=render

echo "== R2 par final.mp4 + voice/ + captions/ upload ho raha hai =="
$RCLONE copy "$WORKDIR/final.mp4" "r2:${R2_BUCKET}/${VIDEO_ID}/"
$RCLONE copy "$WORKDIR/voice/" "r2:${R2_BUCKET}/${VIDEO_ID}/voice/"
$RCLONE copy "$WORKDIR/captions/" "r2:${R2_BUCKET}/${VIDEO_ID}/captions/" || true

echo "== KHATAM — final.mp4 R2 par ready hai: ${VIDEO_ID}/final.mp4 =="
