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
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip python3.11-venv \
    ffmpeg \
    fonts-dejavu-core \
    curl unzip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 (render/voice stage orchestration reuses the existing story-alpha JS code)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---------- ffmpeg with NVENC: TEMPORARILY DISABLED for diagnosis ----------
# (2026-08-17) Three consecutive build failures at ~80-90s, right around
# where GitHub's own status page currently shows "~50% error rate on
# archive/raw-content downloads" (active incident, 16:16 UTC). Removing
# this block to test in isolation whether it's specifically this heavy
# download step or a broader issue — re-add once isolated.
# RUN curl -fsSL -o /tmp/ffmpeg.tar.xz \
#       https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
#     && mkdir -p /tmp/ffmpeg-extract && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1 \
#     && cp /tmp/ffmpeg-extract/bin/ffmpeg /tmp/ffmpeg-extract/bin/ffprobe /usr/local/bin/ \
#     && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extract \
#     && ffmpeg -version

# rclone (R2 sync — S3-compatible)
RUN curl https://rclone.org/install.sh | bash

# ---------- python deps ----------
# torch CUDA build — faster-whisper (Whisper GPU par chale) ke liye, Kokoro
# khud CPU par bhi theek chalta hai (chhota model, 82M params)
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124
RUN pip3 install --no-cache-dir kokoro faster-whisper soundfile numpy

WORKDIR /app

# story-alpha ka code (GitHub se — build ke waqt clone/copy hota hai)
COPY . /app

RUN npm install --omit=dev
RUN chmod +x /app/pod/entrypoint.sh

# R2 credentials aur config runtime par env vars se aate hain (pod launch
# ke waqt RunPod secrets/env set kiye jate hain) — image mein hardcode nahi.
ENTRYPOINT ["/app/pod/entrypoint.sh"]
