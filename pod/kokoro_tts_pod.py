#!/usr/bin/env python3
"""
Kokoro TTS (pod, PARALLEL) -> voiceover.mp3, phir torchaudio forced alignment
(MMS_FA) se word-level timing nikaal kar words.json + voiceover.srt banata hai.

Local machine (Windows) par yehi chunking sequential thi — multiprocessing
Windows ke sandboxed process-tree mein "PermissionError: WinError 5" de kar
toot jati thi (OS-level restriction, code ka bug nahi). Linux pod par ye
restriction nahi hoti, is liye yahan multiprocessing.Pool se saare pod cores
istemal karte hain — chunks ek sath, sequential nahi.

ASLI WAJAH forced alignment (Whisper HATA DIYA, 2026-08-19): Whisper poori
speech-recognition kar raha tha (audio sun kar guess karta kya bola gaya)
jab k hamein pehle se EXACT pata hai kya bola gaya — wahi script.txt jo
Kokoro ko diya gaya. Forced alignment (known text -> audio timing) bohot
halka kaam hai (ek forward pass + DP alignment, koi autoregressive decode
nahi). Isi raat ek real run ne ye confirm kiya: Whisper (CPU, 4 threads —
faster-whisper ka default jo cpu_threads unset chhodne se milta hai) 47.8min
audio par 90min poll-timeout se bhi zyada le gaya, poora pod waste hua
(instance destroy ho gaya bina kaam complete huay). Forced alignment isi
class ka masla structurally khatam kar deta hai.

istemal: kokoro_tts_pod.py <workdir> <voice> <speed> [unused]
chahiye: workdir/script.txt
banata hai: workdir/voice/voiceover.mp3, voiceover.srt, words.json
"""
import json, os, re, subprocess, sys
from pathlib import Path
from multiprocessing import Pool

# ASLI BUG (2026-08-17, teesri koshish): Kokoro pod par GPU dekh kar khud CUDA
# istemal karne ki koshish karta hai — lekin multiprocessing.Pool (Linux
# default "fork") ke andar CUDA context fork nahi ho sakta, is liye HAR
# worker foran crash hota "Cannot re-initialize CUDA in forked subprocess"
# ke sath (544 crashes ek real run mein, 0 chunks kabhi bane hi nahi — pichli
# "hang" bhi shayad yehi cheez thi, sirf chhota log-tail check karne se
# nazar nahi aayi thi). Kokoro ko kabhi GPU chahiye hi nahi tha (chhota
# model, CPU par theek chalta hai) — CUDA ko is process-tree se BILKUL
# GHAAYAB kar do (module import se PEHLE, taake main process ka pre-warm
# aur har forked worker dono hamesha CPU par hi rahen, kabhi CUDA na chhuye).
os.environ['CUDA_VISIBLE_DEVICES'] = ''

VOICE = 'af_bella'
SPEED = 1.0
# ASLI BUG (2026-08-17, chauthi koshish): 215 workers = 215 ALAG copies model
# ki memory mein (har worker apna KPipeline() khud load karta hai, koi
# sharing nahi) — poora 251GB RAM khatam ho gaya, kuch workers OS ne silently
# kill kar diye (koi Python exception nahi — SIGKILL, Pool hamesha ke liye
# un dead workers ka wait karta reh gaya). 161/215 chunks pehle hi ban chuki
# thin lekin kabhi upload nahi hui (SSH access nahi hai is setup mein rescue
# karne ke liye) — poora kaam zaya gaya. Ab worker count sirf CPU cores se
# nahi, MAUJOOD MEMORY se bhi mehdood hai (~1.5GB/worker generous estimate,
# taake headroom rahe) — jo bhi chhota ho wahi asli cap banta hai.
def _safe_worker_cap():
    try:
        with open('/proc/meminfo') as f:
            for line in f:
                if line.startswith('MemAvailable:'):
                    kb = int(line.split()[1])
                    # ASLI BUG #2 (2026-08-18, 96-core/80GB host): 2.0GB/worker
                    # dobara wahi hang laya — bigger host = zyada MemAvailable =
                    # zyada computed cap (40 workers yahan), aur 40 parallel
                    # PyTorch+Kokoro+numpy processes ka asli footprint 2GB se
                    # zyada nikla (chunk 49/77 par ruk gaya, cpu_util 0%, wahi
                    # "Pool dead workers ka wait" signature). 3.0 GB/worker
                    # formula waisi hi rakhi (verified safe — usi shaam ek
                    # 384-core/257GB host par formula khud 85 workers
                    # calculate karta, MemAvailable ke hisaab se).
                    #
                    # ASLI BUG #3 (2026-08-18, same shaam, doosra real run):
                    # hard ceiling 32 tha — formula khud ye 384-core host ke
                    # liye ~85 workers safe bata raha tha, lekin ceiling ne
                    # zabardasti 32 par rok diya, poore run mein sirf 8.3% CPU
                    # use hua (32/384 cores) jab k 251GB+ RAM available thi
                    # (isi run mein 32 workers ne kul 1GB se bhi kam RAM use
                    # kiya — formula ka apna estimate bohot conservative hai).
                    # Ceiling ko 128 tak barhaya (RENDER_CONC ka wahi precedent
                    # is codebase mein already istemal hota hai bade hosts ke
                    # liye) — MEMORY FORMULA hi asli safety-net rehta hai, ye
                    # ceiling sirf ek dur ki outer-bound hai, chhoti hosts par
                    # formula khud hi kam number degi.
                    return max(1, min(128, int((kb / 1024 / 1024) / 3.0)))
    except Exception:
        pass
    return 32  # /proc/meminfo na mile (non-Linux) to conservative fallback

MAX_WORKERS = _safe_worker_cap()

_pipeline = None  # har worker process mein EK dafa load hota hai (initializer)


def _init_worker(voice_hint):
    global _pipeline
    # ASLI BUG (2026-08-17, doosri stuck-instance): PyTorch default mein HAR
    # process apne tensor ops ke liye SAARE visible cores istemal karne ki
    # koshish karta hai. 200+ worker processes, har ek 384 cores maang raha
    # ho — massive oversubscription/thrashing, kisi ko bhi asli CPU time nahi
    # milta (confirmed: cpu_util 0% jab kuch bhi 38 min tak generate nahi
    # hua). Fix: har worker apne aap ko SIRF 1 thread tak mehdood kare —
    # PARALLELISM processes ki tadaad se aata hai, har process ke andar
    # multi-threading se nahi.
    import os
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['MKL_NUM_THREADS'] = '1'
    import torch
    torch.set_num_threads(1)
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


# Local/sequential run (tools/kokoro_tts.py) keeps 150-300 (fewer, bigger
# chunks — no downside there, nothing runs in parallel). Pod version was
# dropped to 25-50 words (~215 chunks) to hit high CPU utilization, but that
# meant ~215 worker processes each loading their own full model copy — blew
# through all 251GB RAM, OS silently killed workers, Pool hung forever,
# 161/215 already-generated chunks lost (no SSH access to rescue them).
# 90-150 (~70-80 chunks, 2026-08-17) is the actual sweet spot: still real
# parallelism (vs the original 36), far short of the memory ceiling that
# broke the 215-chunk attempt. Combined with the memory-aware MAX_WORKERS
# cap above, this should stay safely within RAM regardless of the exact
# core/RAM ratio a given pod rental happens to have.
def chunk_text(text, min_w=90, max_w=150):
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
    vdir = wd / 'voice'
    vdir.mkdir(parents=True, exist_ok=True)
    chunks_dir = vdir / 'kokoro_chunks'
    chunks_dir.mkdir(exist_ok=True)

    text = (wd / 'script.txt').read_text(encoding='utf-8')
    blocks = chunk_text(text)
    n_workers = min(MAX_WORKERS, max(1, os.cpu_count() or 1), len(blocks))
    print(f"{len(text.split())} words -> {len(blocks)} chunks (Kokoro, voice={VOICE}, {n_workers} parallel workers)", flush=True)

    # ASLI BUG: pehle seedha Pool bana kar N workers ek sath _init_worker chalate
    # thay — sab EK SATH Hugging Face Hub se (unauthenticated) model weights
    # download/verify karne ki koshish karte, aur HF rate-limit se sab phans
    # jate (7 min mein 0 chunks). Ab pehle MAIN process mein EK dafa load karo
    # (download + local cache), TAB Pool banao — workers ka apna load phir
    # sirf local disk se hota hai, koi network race nahi.
    print("Kokoro model pehle se load kar raha hun (cache warm, taake workers ek sath download na karein)...", flush=True)
    from kokoro import KPipeline
    KPipeline(lang_code='a')
    print("cache warm ho gaya, ab parallel workers shuru", flush=True)

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

    # ---------- Forced alignment: word-level timing wapas nikalo ----------
    # Whisper (speech recognition — guess karta kya bola gaya) ki jagah
    # forced alignment (known text -> audio timing, koi guessing nahi) —
    # dekho file ke top ka comment. Per-chunk chalate hain: audio pehle se
    # hi Kokoro ke ~90-150-word blocks mein bana hua hai (chunks_dir), har
    # chunk ki apni known text (blocks[i]) bhi maujood hai — koi 47min
    # single-pass forward nahi karna, har chunk chhota aur tez hai, aur
    # doosre pod-memory-blowup bugs (dekho upar ke comments) jaisi class ka
    # risk khatam ho jata hai (ek hi model, main process mein sequential —
    # koi Pool/N-copies-of-model nahi).
    print("Forced alignment (torchaudio MMS_FA) se word timing nikaal raha hun...", flush=True)
    import torch
    import torchaudio as ta
    from torchaudio.pipelines import MMS_FA as ALIGN_BUNDLE
    torch.set_num_threads(max(1, min(16, os.cpu_count() or 4)))
    align_model = ALIGN_BUNDLE.get_model().to('cpu')
    align_model.eval()
    align_tokenizer = ALIGN_BUNDLE.get_tokenizer()
    align_aligner = ALIGN_BUNDLE.get_aligner()

    def clean_for_align(token):
        c = re.sub(r"[’‘]", "'", token)
        c = re.sub(r"[^a-zA-Z']", '', c).lower()
        return c

    # ---- chunk durations + cumulative offsets pehle hi nikaal lo (sequential
    # order mein — chunk i ka offset sirf chunk 0..i-1 ki durations ka sum) ----
    import soundfile as sf
    chunk_durs = []
    for p in paths:
        sf_info = sf.info(str(p))
        chunk_durs.append(sf_info.frames / sf_info.samplerate)
    offsets = [0.0]
    for d in chunk_durs[:-1]:
        offsets.append(offsets[-1] + d)

    words, cues = [], []
    for i, (block, wav_path, offset) in enumerate(zip(blocks, paths, offsets)):
        orig_tokens = block.split()
        align_tokens, display_tokens = [], []
        for t in orig_tokens:
            c = clean_for_align(t)
            if c:
                align_tokens.append(c)
                display_tokens.append(t)
        if not align_tokens:
            continue
        waveform, sr = ta.load(str(wav_path))
        if sr != ALIGN_BUNDLE.sample_rate:
            waveform = ta.functional.resample(waveform, sr, ALIGN_BUNDLE.sample_rate)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        try:
            with torch.inference_mode():
                emission, _ = align_model(waveform)
                tokens = align_tokenizer(align_tokens)
                token_spans = align_aligner(emission[0], tokens)
            ratio = waveform.shape[1] / emission.shape[1] / ALIGN_BUNDLE.sample_rate
            chunk_words = []
            for disp, spans in zip(display_tokens, token_spans):
                start = spans[0].start * ratio + offset
                end = spans[-1].end * ratio + offset
                chunk_words.append({'word': disp, 'start': round(start, 3), 'end': round(end, 3)})
        except Exception as e:
            # ek chunk ki alignment fail ho — poori 47min run ko na girao,
            # is chunk ke words ko chunk ki known duration par evenly
            # bant do (crude fallback, sirf yahi ek chunk ke liye).
            print(f"  [warn] chunk {i + 1} alignment fail ({e}) — evenly-spaced fallback", flush=True)
            step = chunk_durs[i] / max(1, len(display_tokens))
            chunk_words = [{'word': disp, 'start': round(offset + j * step, 3), 'end': round(offset + (j + 1) * step, 3)}
                           for j, disp in enumerate(display_tokens)]

        words.extend(chunk_words)

        # ---- cues: sentence-boundary par split (. ! ?), taake timeline
        # stage ke slot-pacing target (~2.5-6s) ke liye kaafi chhote rahen ----
        buf = []
        for w in chunk_words:
            buf.append(w)
            if w['word'].rstrip('"\')’”').endswith(('.', '!', '?')) or w is chunk_words[-1]:
                cues.append({'start': buf[0]['start'], 'end': buf[-1]['end'], 'text': ' '.join(x['word'] for x in buf)})
                buf = []
        print(f"  [{i + 1}/{len(blocks)}] chunk {i + 1} aligned", flush=True)

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
