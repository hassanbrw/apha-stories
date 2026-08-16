# ============================================================
#  RunPod image — voice (Chatterbox, GPU) + render (ffmpeg, NVENC)
#
#  Ye image sirf VOICE aur RENDER stages chalata hai. Script/prompts/images
#  local machine par hi bantay hain (Gemini browser login yahan possible
#  nahi, aur script/prompts generation GPU se koi faida nahi leta). Pod
#  R2 se script.txt + images/ download karta hai, voice+render karta hai,
#  phir final.mp4 wapas R2 par upload kar deta hai.
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
# torch CUDA build zaroori hai (Chatterbox GPU par chale, CPU build nahi)
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124
RUN pip3 install --no-cache-dir chatterbox-tts faster-whisper soundfile numpy

WORKDIR /app

# story-alpha ka code (GitHub se — build ke waqt clone/copy hota hai)
COPY . /app

RUN npm install --omit=dev
RUN chmod +x /app/pod/entrypoint.sh

# R2 credentials aur config runtime par env vars se aate hain (pod launch
# ke waqt RunPod secrets/env set kiye jate hain) — image mein hardcode nahi.
ENTRYPOINT ["/app/pod/entrypoint.sh"]
