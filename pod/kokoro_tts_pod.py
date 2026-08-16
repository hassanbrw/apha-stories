#!/usr/bin/env python3
"""
Kokoro TTS (pod, PARALLEL) -> voiceover.mp3, phir faster-whisper se word-level
timing nikaal kar words.json + voiceover.srt banata hai.

Local machine (Windows) par yehi chunking sequential thi — multiprocessing
Windows ke sandboxed process-tree mein "PermissionError: WinError 5" de kar
toot jati thi (OS-level restriction, code ka bug nahi). Linux pod par ye
restriction nahi hoti, is liye yahan multiprocessing.Pool se saare pod cores
istemal karte hain — chunks ek sath, sequential nahi.

istemal: kokoro_tts_pod.py <workdir> <voice> <speed> <whisper_model>
chahiye: workdir/script.txt
banata hai: workdir/voice/voiceover.mp3, voiceover.srt, words.json
"""
import json, os, re, subprocess, sys
from pathlib import Path
from multiprocessing import Pool

VOICE = 'af_bella'
SPEED = 1.0
# bahut zyada workers per-process overhead (model load) se faida ulta kam kar
# dete hain — 32 par cap kiya hai, 36 chunk jaisi ek video mein ek hi round
# mein taqreeban sab kuch parallel ho jata hai
MAX_WORKERS = 32

_pipeline = None  # har worker process mein EK dafa load hota hai (initializer)


def _init_worker(voice_hint):
    global _pipeline
    from kokoro import KPipeline
    _pipeline = KPipeline(lang_code='a')


def _gen_chunk(args):
    idx, block, out_path, voice, speed = args
    if out_path.exists() and out_path.stat().st_size > 20000:
        return (idx, 'cached')
    import numpy as np
    import soundfile as sf
    audio_parts = []
    for result in _pipeline(block, voice=voice, speed=speed):
        audio_parts.append(result.audio)
    audio = np.concatenate(audio_parts)
    sf.write(str(out_path), audio, 24000)
    return (idx, 'done')


def chunk_text(text, min_w=150, max_w=300):
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
    n_workers = min(MAX_WORKERS, max(1, os.cpu_count() or 1), len(blocks))
    print(f"{len(text.split())} words -> {len(blocks)} chunks (Kokoro, voice={VOICE}, {n_workers} parallel workers)", flush=True)

    paths = [chunks_dir / f"chunk_{i:03d}.wav" for i in range(len(blocks))]
    tasks = [(i, blocks[i], paths[i], VOICE, SPEED) for i in range(len(blocks))]

    done = 0
    with Pool(processes=n_workers, initializer=_init_worker, initargs=(VOICE,)) as pool:
        for idx, status in pool.imap_unordered(_gen_chunk, tasks):
            done += 1
            print(f"  [{done}/{len(blocks)}] chunk {idx + 1} {status}", flush=True)

    # ---------- sab chunks ek mp3 mein jodo (asli tarteeb mein) ----------
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

    # ---------- Whisper: word-level timing wapas nikalo ----------
    print(f"Whisper ({WHISPER_MODEL}) se word timing nikaal raha hun...", flush=True)
    from faster_whisper import WhisperModel

    device = 'cuda' if os.environ.get('POD_HAS_GPU', '1') == '1' else 'cpu'
    try:
        wmodel = WhisperModel(WHISPER_MODEL, device=device, compute_type='float16' if device == 'cuda' else 'int8')
    except Exception:
        wmodel = WhisperModel(WHISPER_MODEL, device='cpu', compute_type='int8')
    segments, info = wmodel.transcribe(str(out_mp3), word_timestamps=True, language='en')

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
