#!/usr/bin/env python3
"""
Halka floating dust/light-particle overlay banata hai — soft white specks
jo bahut aahista drift karte hain aur halka twinkle karte hain (romance/
cinematic edits mein aam). Ek chhota SEAMLESS loop banta hai (default 20s),
phir render mein poori video ki lambai tak tile ho kar chalta hai — is liye
ye sirf EK DAFA banta hai aur sab videos mein reuse hota hai (cache).

istemal: particles.py <out.mov> <W> <H> <fps> <loop_seconds> [count] [opacity 0-255]
banata hai: out (alpha ke sath .mov, qtrle)
"""
import math, os, random, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
W, H, fps = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
loop_s = float(sys.argv[5])
COUNT = int(sys.argv[6]) if len(sys.argv) > 6 else 45
OPACITY = int(sys.argv[7]) if len(sys.argv) > 7 else 60   # bilkul halka — 255 mein se

# Particle motion halki fps par bani hai (internal_fps) — ffmpeg baad mein
# asli fps tak duplicate kar deta hai (particles itni aahista chalte hain ke
# farq nazar nahi aata) — is se PIL frame count kaafi kam ho jata hai.
INTERNAL_FPS = min(15, fps)
N = max(1, int(loop_s * INTERNAL_FPS))

random.seed(7)   # deterministic — har render mein wahi loop, ek dafa cache
particles = []
for i in range(COUNT):
    particles.append({
        "x": random.uniform(0, W),
        "y": random.uniform(0, H),
        "r": random.uniform(1.5, 4.5),
        "vy": random.uniform(-9, -3),      # halka upar ki taraf, seamless wraparound
        "vx": random.uniform(-1.5, 1.5),
        "op": random.uniform(0.25, 0.9),
        "phase": random.uniform(0, math.pi * 2),
    })

tmp_dir = out + "_frames"
os.makedirs(tmp_dir, exist_ok=True)

for f in range(N):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    t = f / INTERNAL_FPS
    for p in particles:
        x = (p["x"] + p["vx"] * t) % W
        y = (p["y"] + p["vy"] * t) % H
        twinkle = 0.6 + 0.4 * math.sin(p["phase"] + t * 1.3)
        a = max(0, int(OPACITY * p["op"] * twinkle))
        r = p["r"]
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    im = im.filter(ImageFilter.GaussianBlur(1.1))   # soft glow, halka
    im.save(os.path.join(tmp_dir, f"p{f:04d}.png"))

lst = os.path.join(tmp_dir, "list.txt")
with open(lst, "w") as fh:
    for f in range(N):
        fh.write(f"file 'p{f:04d}.png'\nduration {1 / INTERNAL_FPS:.5f}\n")
    fh.write(f"file 'p{N - 1:04d}.png'\n")   # concat demuxer aakhri file dobara maangta hai

subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                "-i", "list.txt", "-vf", f"fps={fps},format=rgba", "-c:v", "qtrle",
                os.path.abspath(out)], check=True, cwd=tmp_dir)
print(f"particles loop - {out}, {COUNT} particles, {loop_s}s @ {fps}fps (opacity {OPACITY}/255)")
