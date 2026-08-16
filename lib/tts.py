#!/usr/bin/env python3
"""script.txt -> voiceover.mp3   (§6.1)

ai33 TTS. Chunk into 200-400 word paragraph groups, submit each, poll, download,
concat with ffmpeg. Never submit 4,000 words in one call.

  python3 tools/tts.py <workdir>
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, uuid

BASE  = "https://api.ai33.pro"
KEY   = os.environ.get("AI33_KEY", "")
VOICE = os.environ.get("AI33_VOICE", "elevenlabs_bIHbv24MWmeRgasZH58o")
UA    = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HEAD  = {"xi-api-key": KEY, "User-Agent": UA}          # UA required or Cloudflare 403s

MIN_W, MAX_W = 200, 380


def _multipart(fields):
    b = "----rn" + uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += (f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n"
                f"{v}\r\n").encode()
    out += f"--{b}--\r\n".encode()
    return b, out


def _post(path, fields, tries=4):
    b, body = _multipart(fields)
    h = dict(HEAD); h["Content-Type"] = f"multipart/form-data; boundary={b}"
    for a in range(tries):
        try:
            r = urllib.request.Request(BASE + path, data=body, headers=h, method="POST")
            return json.load(urllib.request.urlopen(r, timeout=180))
        except Exception as e:
            print(f"    post retry {a+1}: {e}")
            time.sleep(5 * (a + 1))
    raise RuntimeError(f"POST {path} failed")


def _get(path, tries=4):
    for a in range(tries):
        try:
            r = urllib.request.Request(BASE + path, headers=HEAD)
            return json.load(urllib.request.urlopen(r, timeout=120))
        except Exception as e:
            print(f"    get retry {a+1}: {e}")
            time.sleep(4 * (a + 1))
    raise RuntimeError(f"GET {path} failed")


def chunk(text):
    """Group paragraphs (or sentences) into 200-380 word blocks."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) < 3:                       # no blank lines -> split on sentences
        paras = re.findall(r"[^.!?]+[.!?]+(?:['\"”]?)\s*", text)
        paras = [p.strip() for p in paras if p.strip()]
    out, cur, n = [], [], 0
    for p in paras:
        w = len(p.split())
        if n + w > MAX_W and n >= MIN_W:
            out.append(" ".join(cur)); cur, n = [], 0
        cur.append(p); n += w
    if cur:
        if n < 60 and out:                   # fold a runt into the previous block
            out[-1] += " " + " ".join(cur)
        else:
            out.append(" ".join(cur))
    return out


def tts(text, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 20000:
        return dest
    r = _post("/v3/text-to-speech",
              {"text": text, "voice_id": VOICE, "speed": "1.0"})
    tid = r.get("task_id") or (r.get("data") or {}).get("task_id")
    if not tid:
        raise RuntimeError(f"no task_id: {str(r)[:300]}")
    url = None
    for _ in range(180):
        time.sleep(4)
        s = _get(f"/v3/task/{tid}")
        d = s.get("data") or {}
        st = d.get("status")
        if st == "done":
            url = (d.get("metadata") or {}).get("audio_url")
            break
        if st in ("failed", "error"):
            raise RuntimeError(f"task failed: {str(s)[:300]}")
    if not url:
        raise RuntimeError("timed out waiting for TTS task")
    rc = subprocess.run(["curl", "-s", "-m", "300", "-A", UA, "-o", dest, url]).returncode
    if rc != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 20000:
        raise RuntimeError(f"download failed: {url}")
    return dest


def dur(p):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", p], capture_output=True, text=True).stdout.strip())


def main(wd):
    text = open(os.path.join(wd, "script.txt")).read()
    words = len(text.split())
    cd = os.path.join(wd, "vo_chunks"); os.makedirs(cd, exist_ok=True)
    blocks = chunk(text)
    print(f"{words} words -> {len(blocks)} chunks")
    paths = []
    for i, b in enumerate(blocks):
        p = os.path.join(cd, f"chunk_{i:03d}.mp3")
        print(f"  [{i+1}/{len(blocks)}] {len(b.split()):4d}w", flush=True)
        tts(b, p)
        paths.append(p)
    lst = os.path.join(cd, "list.txt")
    with open(lst, "w") as f:
        for p in paths:
            f.write(f"file '{os.path.abspath(p)}'\n")
    out = os.path.join(wd, "voiceover.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", lst, "-c:a", "libmp3lame", "-b:a", "192k", out], check=True)
    d = dur(out)
    json.dump({"words": words, "chunks": len(blocks), "duration": d,
               "chunk_files": paths},
              open(os.path.join(wd, "vo_meta.json"), "w"), indent=1)
    print(f"\nvoiceover.mp3  {d:.1f}s  ({d/60:.2f} min)")
    if d < 1200:
        print(f"BLOCKING: {d:.0f}s < 1200s floor (§6.2). Extend the script.")
        sys.exit(2)
    print("PASS: >= 20:00 floor")


if __name__ == "__main__":
    main(sys.argv[1])
