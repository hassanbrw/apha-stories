# ===============================================================
#  Pod image: voice (Kokoro, parallel across pod cores) + render (ffmpeg)
#
#  Ye image sirf VOICE aur RENDER stages chalata hai. Script/prompts/images
#  local machine par hi bantay hain (Gemini browser login yahan possible
#  nahi, aur script/prompts generation GPU se koi faida nahi leta). Pod
#  R2 se script.txt + images/ download karta hai, voice+render karta hai,
#  phir final.mp4 wapas R2 par upload kar deta hai.
#
#  Chatterbox HATA DIYA (2026-08-17) — cloned voice ~420 wpm (3x too fast)
#  nikli aur clarity/cloning quality bhi kharab thi, do real pod runs mein
#  confirm hua. Kokoro (proven, 4 videos mein pehle se istemal) wapas
#  default hai — Linux pod par multiprocessing.Pool se parallel chalta hai
#  (Windows local machine par ye OS-level restriction se sequential chalta
#  tha, dekho pod/kokoro_tts_pod.py).
# ============================================================
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# ---------- system packages ----------
# ASLI BUG (2026-08-17, tonight ka pod render crash ki asal wajah nikli):
# tools/captions.py apne FONT_CANDIDATES list se pehla mojood font DHOOND kar
# load karta hai (Windows par segoeuib.ttf, Linux fallback DejaVuSans-Bold.ttf)
# — lekin is Docker image mein KOI font package kabhi install hi nahi hua
# tha. Bare Ubuntu container par koi TTF file kahin nahi milti, is liye
# ImageFont.truetype() crash ho jata — captions generate hi nahi ho pati thi,
# render har baar wahin fail hota. fonts-dejavu-core add kar diya (wahi font
# jo captions.py ka Linux fallback path already expect karta hai).
# ASLI BUG #2 (2026-08-17, isolated tonight's first real render attempt
# that got past slot-building): stages/2-voice.js aur stages/9-render.js
# dono `python` (as `python3` NAHI) call karte hain — apt ka python3.11
# sirf `python3`/`python3.11` binary deta hai, `python` symlink NAHI
# banata. Bare image par "spawnSync python ENOENT" se render har baar
# particles.py par crash hota — is se pehle koi render pod par kabhi is
# point tak pahunch hi nahi paya tha, is liye pata hi nahi chala. Debian
# ka apna standard fix `python-is-python3` package hai.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip python3.11-venv python-is-python3 \
    ffmpeg \
    fonts-dejavu-core \
    curl unzip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 (render/voice stage orchestration reuses the existing story-alpha JS code)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# NVENC (2026-08-17) SHELVED for tonight: tried swapping apt ffmpeg for a
# BtbN static build (NVENC-enabled) via a GitHub release-asset download —
# confirmed via a clean A-B test (build succeeds without this step, fails
# consistently with it, even with 5 curl retries) that this specific
# download path is unreliable right now, most likely tied to GitHub's own
# active "archive/raw-content downloads" incident (their status page
# showed this exact symptom at the time). Not worth blocking tonight's
# real deliverable (concurrency fix + libass captions, both already
# working) on this — stock apt ffmpeg still HAS libass (the bigger win),
# just not NVENC. stages/9-render.js's detectNVENC() already fails safe
# (h264_nvenc simply won't be a registered encoder, falls through to
# QSV/libx264) — no code change needed there to shelve this; revisit the
# NVENC download source in a future session with more time to verify an
# alternate host properly.

# rclone (R2 sync — S3-compatible)
RUN curl https://rclone.org/install.sh | bash

# ---------- python deps ----------
# torch/torchaudio — Kokoro (CPU, chhota model) aur forced alignment
# (torchaudio MMS_FA — script ka known text audio se align karta hai,
# Whisper-style speech-recognition ki zaroorat nahi) dono ke liye.
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124
# ASLI BUG #3 (2026-08-17): Pillow yahan kabhi tha hi nahi — tools/particles.py
# `from PIL import Image, ImageDraw, ImageFilter` karta hai. Pehle koi render
# is stage tak pahunch hi nahi paya tha (pehle python-symlink bug ne rok
# rakha tha), is liye pata nahi chala — dikhne mein bilkul particles.py ka
# kaam khatam hote hi crash hota, aur Vast.ai nonzero exit par khud restart
# kar deta (pehle se pata chala tha), matlab poore 175/183 slots baar baar
# banate rehte bina kabhi render mukammal huay — 6 restart cycles isi
# session mein zaya huay is se pehle pakda gaya.
RUN pip3 install --no-cache-dir kokoro soundfile numpy pillow

WORKDIR /app

# story-alpha ka code (GitHub se — build ke waqt clone/copy hota hai)
COPY . /app

RUN npm install --omit=dev
RUN chmod +x /app/pod/entrypoint.sh

# R2 credentials aur config runtime par env vars se aate hain (pod launch
# ke waqt RunPod secrets/env set kiye jate hain) — image mein hardcode nahi.
ENTRYPOINT ["/app/pod/entrypoint.sh"]
