#!/usr/bin/env python3
"""
Kokoro (local, free, no API cost) TTS -> voiceover.mp3, phir faster-whisper
se word-level timing nikaal kar words.json + voiceover.srt banata hai.

Poora pipeline (timeline, captions, everything) SRT/words.json par khara hai —
Kokoro khud timing nahi deta (ai33 deta tha), is liye Whisper isay wapas
"sunn" kar reconstruct karta hai.

istemal: kokoro_tts.py <workdir> <voice> <speed> <whisper_model>
chahiye: workdir/script.txt
banata hai: workdir/voice/voiceover.mp3, voiceover.srt, words.json
"""
import json, os, re, subprocess, sys
from pathlib import Path

import numpy as np
import soundfile as sf

# TRIED multiprocessing.Pool yahan (2 workers, cores khaali na rahen) — is
# machine ke sandboxed process-tree (bash -> node -> python -> spawned
# worker) mein Windows ki multiprocessing pipe/handle duplication
# "PermissionError: [WinError 5] Access is denied" de kar beech mein hi
# TOOT jati hai (2/4 chunks ke baad). Ye is environment ka OS-level
# restriction lagta hai, code ka bug nahi — is liye WAPAS sequential par
# aa gaye. Agar kabhi normal (non-sandboxed) terminal se chalana ho to
# dobara try kiya ja sakta hai.
VOICE = 'af_bella'
SPEED = 1.0


def chunk_text(text, min_w=150, max_w=300):
    """200-300 lafz ke paragraphs — Kokoro ek dam poora 10K-word script nahi
    leta, aur chhote chunks resumability bhi dete hain (beech mein ruko to
    dobara wahin se)."""
    paras = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    out, cur, n = [], [], 0
    for p in paras:
        w = len(p.split())
        if n + w > max_w and n >= min_w:
            out.append('\n\n'.join(cur))
            cur, n = [], 0
        cur.append(p)
        n += w
    if cur:
        if n < 40 and out:
            out[-1] += '\n\n' + '\n\n'.join(cur)
        else:
            out.append('\n\n'.join(cur))
    return out


def to_ts(x):
    h = int(x // 3600)
    m = int(x % 3600 // 60)
    s = int(x % 60)
    ms = int(round((x % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    global VOICE, SPEED
    wd = Path(sys.argv[1])
    VOICE = sys.argv[2] if len(sys.argv) > 2 else 'af_bella'
    SPEED = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    WHISPER_MODEL = sys.argv[4] if len(sys.argv) > 4 else 'small'

    vdir = wd / 'voice'
    vdir.mkdir(parents=True, exist_ok=True)
    chunks_dir = vdir / 'kokoro_chunks'
    chunks_dir.mkdir(exist_ok=True)

    text = (wd / 'script.txt').read_text(encoding='utf-8')
    blocks = chunk_text(text)
    print(f"{len(text.split())} words -> {len(blocks)} chunks (Kokoro, voice={VOICE})", flush=True)

    from kokoro import KPipeline
    pipeline = KPipeline(lang_code='a')  # 'a' = American English

    paths = []
    for i, block in enumerate(blocks):
        p = chunks_dir / f"chunk_{i:03d}.wav"
        paths.append(p)
        if p.exists() and p.stat().st_size > 20000:
            print(f"  [{i + 1}/{len(blocks)}] pehle se maujood", flush=True)
            continue
        print(f"  [{i + 1}/{len(blocks)}] {len(block.split())}w", flush=True)
        audio_parts = []
        for result in pipeline(block, voice=VOICE, speed=SPEED):
            if result.audio is not None:
                audio_parts.append(result.audio.numpy())
        if not audio_parts:
            raise RuntimeError(f"chunk {i} — Kokoro se koi audio nahi aaya")
        audio = np.concatenate(audio_parts)
        sf.write(str(p), audio, 24000)

    # ---------- sab chunks ek mp3 mein jodo ----------
    lst = vdir / 'kokoro_list.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in paths:
            f.write(f"file '{p.resolve().as_posix()}'\n")
    out_mp3 = vdir / 'voiceover.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                     '-i', str(lst), '-c:a', 'libmp3lame', '-b:a', '192k', str(out_mp3)], check=True)
    lst.unlink()

    dur = float(subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', str(out_mp3)], capture_output=True, text=True).stdout.strip())
    print(f"voiceover.mp3 - {dur:.1f}s ({dur / 60:.2f} min)", flush=True)

    # ---------- Whisper: audio ko "sun" kar word-level timing wapas nikalo ----------
    print(f"Whisper ({WHISPER_MODEL}) se word timing nikaal raha hun...", flush=True)
    from faster_whisper import WhisperModel

    model = WhisperModel(WHISPER_MODEL, device='cpu', compute_type='int8')
    segments, info = model.transcribe(str(out_mp3), word_timestamps=True, language='en')

    words, cues = [], []
    for seg in segments:
        cue_words = []
        for w in (seg.words or []):
            wt = (w.word or '').strip()
            if not wt:
                continue
            words.append({'word': wt, 'start': round(w.start, 3), 'end': round(w.end, 3)})
            cue_words.append(wt)
        if cue_words:
            cues.append({'start': seg.start, 'end': seg.end, 'text': ' '.join(cue_words)})

    (vdir / 'words.json').write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')

    srt = ''.join(
        f"{i + 1}\n{to_ts(c['start'])} --> {to_ts(c['end'])}\n{c['text']}\n\n"
        for i, c in enumerate(cues)
    )
    (vdir / 'voiceover.srt').write_text(srt, encoding='utf-8')

    print(f"words.json - {len(words)} words", flush=True)
    print(f"voiceover.srt - {len(cues)} cues", flush=True)
    print(f"DURATION={dur:.3f}", flush=True)


if __name__ == '__main__':
    main()
