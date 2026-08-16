# ============================================================
#  Pod image — voice (Kokoro, parallel across pod cores) + render (ffmpeg)
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
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip python3.11-venv \
    ffmpeg \
    curl unzip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 (render/voice stage orchestration reuses the existing story-alpha JS code)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

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
