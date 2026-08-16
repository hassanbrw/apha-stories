#!/usr/bin/env python3
"""
Word-highlight captions ka alag transparent track banata hai — jaise
short-form captions mein hota hai: jo lafz us waqt bola ja raha hai wahi
ek highlight color mein, baaki safed.

Is machine ki ffmpeg libass/freetype ke baghair bani hui hai (naapa gaya:
`ffmpeg -filters` mein na ass hai, na subtitles, na drawtext). Is liye text
PIL se likhte hain — har active-word state ki ek RGBA PNG — aur unhein ek
alpha-wali video mein jod kar upar overlay kar dete hain.

PERFORMANCE: ek 60+ minute video mein ~10,000 alag word-states ban sakte
hain. Poore 1920x1080 frame ki jagah sirf CAPTION STRIP (chhoti height,
poori width) banate hain — render bahut tez hoti hai (~6-7x kam pixels).
Caller (stages/9-render.js) isay ffmpeg overlay se sahi Y position par
chipka deta hai (CAP_H is script ke stdout ki last line mein print hota hai).

istemal: captions.py <words.json> <out_dir> <total_seconds> <W> <H> <fps> [hex_color] [position]
banata hai: out_dir/frames/*.png aur out_dir/caps.mov (alpha, sirf strip height)
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

words_f, out_dir, total, W, H, fps = sys.argv[1], os.path.abspath(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
HILITE_HEX = sys.argv[7] if len(sys.argv) > 7 else "#FFD700"     # gold — competitor-style karaoke highlight
POSITION = sys.argv[8] if len(sys.argv) > 8 else "left-bottom"

def hex_to_rgba(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

HILITE = hex_to_rgba(HILITE_HEX)
WHITE = (255, 255, 255, 255)

# OS ke hisab se pehla mojood font istemal karo. Impact bahut condensed/tall
# tha aur competitor jaisa round/friendly nahi lagta — Segoe UI Bold zyada
# qareeb hai (screenshot compare kiya gaya).
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",             # macOS
    "C:\\Windows\\Fonts\\segoeuib.ttf",                             # Windows — round bold, competitor jaisa
    "C:\\Windows\\Fonts\\arialbd.ttf",                              # Windows fallback
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",        # Linux
]
FONT = next((f for f in FONT_CANDIDATES if os.path.exists(f)), FONT_CANDIDATES[0])
SIZE = int(H * 0.044)          # 1080p par ~48px
LINE_GAP = int(H * 0.01)       # do lines ke darmiyan gap
PAD = int(H * 0.018)           # strip ke upar/descenders ke liye thori jagah
MAX_LINES = 2                  # competitor jaisa: ek se do lines, hamesha center mein
MAX_TEXT_W = int(W * 0.86)     # dono taraf halka margin
CAP_H = MAX_LINES * SIZE + (MAX_LINES - 1) * LINE_GAP + PAD * 2
BOTTOM_GAP = int(H * 0.035)    # frame ke bilkul neeche se thora upar rakho (flush nahi)
os.makedirs(os.path.join(out_dir, "frames"), exist_ok=True)

words = json.load(open(words_f, encoding="utf-8"))
def gv(w, *k):
    for x in k:
        if isinstance(w, dict) and w.get(x) is not None: return w[x]
    return None

# ~1.6s ka jitna bhi bole jaye ek group — competitor jaisa 2-line block banane
# ke liye kaafi lafz chahiye (pehle sirf 3 the, bahut chhote/left-aligned lagte
# the). Upper cap sirf bahut tez bolne wale hisson ke liye safety hai.
groups, cur = [], []
for w in words:
    t0, t1, tx = gv(w, 'start', 'begin'), gv(w, 'end', 'stop'), gv(w, 'word', 'text')
    if t0 is None or t1 is None or not tx: continue
    cur.append((float(t0), float(t1), str(tx).strip()))
    if len(cur) >= 10 or (cur[-1][1] - cur[0][0]) > 1.6:
        groups.append(cur); cur = []
if cur: groups.append(cur)

font = ImageFont.truetype(FONT, SIZE)
blank = os.path.join(out_dir, "frames", "blank.png")
Image.new("RGBA", (W, CAP_H), (0, 0, 0, 0)).save(blank)

# 8-directional outline (halka, poore 24-point se ~3x tez) — phir bhi har
# background par saaf parhi jaye
STROKE_OFFSETS = ((-2, -2), (-2, 2), (2, -2), (2, 2), (-2, 0), (2, 0), (0, -2), (0, 2))

def stroke_text(d, xy, text, fill):
    x, y = xy
    for dx, dy in STROKE_OFFSETS:
        d.text((x + dx, y + dy), text, font=font, fill=(0, 0, 0, 235))
    d.text((x, y), text, font=font, fill=fill)

_dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
def text_w(t):
    return _dummy.textlength(t, font=font)
SPACE_W = text_w(" ")

# group ke lafz ko MAX_TEXT_W ke andar (max 2 lines) wrap karta hai — ye
# tarteeb HAR frame ke liye same rehti hai (ek dafa group ke liye), taake
# lafz highlight hote waqt line na badle/na uchale.
def wrap_group(group_words):
    lines, cur_line, cur_w = [], [], 0
    for (_, _, w) in group_words:
        text = w.upper()
        tw = text_w(text)
        add = tw if not cur_line else tw + SPACE_W
        if cur_line and cur_w + add > MAX_TEXT_W and len(lines) < MAX_LINES - 1:
            lines.append(cur_line); cur_line, cur_w = [text], tw
        else:
            cur_line.append(text); cur_w += add
    if cur_line: lines.append(cur_line)
    return lines

def draw(lines, active_i, path):
    im = Image.new("RGBA", (W, CAP_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    line_h = SIZE + LINE_GAP
    start_y = CAP_H - PAD - SIZE - (len(lines) - 1) * line_h   # neeche wali line hamesha isi jagah
    idx = 0
    for li, line_words in enumerate(lines):
        line_w = sum(text_w(w) for w in line_words) + SPACE_W * (len(line_words) - 1)
        x = (W - line_w) / 2
        y = start_y + li * line_h
        for w in line_words:
            stroke_text(d, (x, y), w, HILITE if idx == active_i else WHITE)
            x += text_w(w) + SPACE_W
            idx += 1
    im.save(path)

# timeline: (start, end, png) — ek group ke andar har lafz apne hi waqt tak highlight rehta hai
items, prev_end = [], 0.0
for gi, g in enumerate(groups):
    group_end = min(g[-1][1] + 0.06, total)
    if group_end <= g[0][0]: continue
    if g[0][0] > prev_end + 0.02: items.append((prev_end, g[0][0], blank))
    lines = wrap_group(g)
    for wi, (ws, we, wt) in enumerate(g):
        seg_start = ws
        seg_end = g[wi + 1][0] if wi + 1 < len(g) else group_end
        if seg_end <= seg_start: continue
        p = os.path.join(out_dir, "frames", f"c{gi:05d}_{wi}.png")
        # size check zaroori — agar pichla run beech mein rok diya gaya (kill/
        # interrupt) to 0-byte ya adhoori PNG bach sakti hai; sirf existence
        # dekhna is kaafi nahi, warna ffmpeg concat "Invalid PNG signature" deta hai
        if not os.path.exists(p) or os.path.getsize(p) < 100: draw(lines, wi, p)
        items.append((seg_start, seg_end, p))
    prev_end = group_end
if prev_end < total: items.append((prev_end, total, blank))

lst = os.path.join(out_dir, "caps_list.txt")
# concat demuxer relative raaste list file ke folder se jodta hai — is liye absolute
#
# ASLI BUG (timing sync): har chhote lafz (jis ki asli duration 1 frame
# [~0.04s] se kam ho — bohot aam hai, "a", "the", "is" jaise lafz) ko yahan
# 0.04s tak barha diya jata tha. Ek 10,000-lafz wali ~60min video mein ye
# chhoti si barhotri HAZAARON dafa hoti hai — jama ho kar video ke aakhir tak
# captions ko asli awaaz se kaafi seconds peeche kar deti thi. Fix: har
# segment ki duration is hisaab se do ke CUMULATIVE output time uske ASLI
# (absolute) end time "b" ke jitna qareeb ho sake rahe — sirf pichli
# duration se relative hisaab lagana (jaisa pehle try kiya) kaam nahi karta,
# kyunke ek dafa qarza ban jaye to wapas nahi hota. Ab agla lamba segment
# khud chhota ho kar pakad leta hai, is liye total waqt hamesha asli audio
# se match karta hai.
cum_out = 0.0
with open(lst, "w", encoding="utf-8") as f:
    for a, b, p in items:
        use = max(0.04, b - cum_out)
        cum_out += use
        f.write(f"file '{p}'\nduration {use:.3f}\n")
    f.write(f"file '{items[-1][2]}'\n")     # concat demuxer aakhri file dobara maangta hai

out = os.path.join(out_dir, "caps.mov")
subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                "-vf", f"fps={fps},format=rgba", "-c:v", "qtrle", "-t", f"{total:.3f}", out], check=True)
print(f"caps.mov - {len(groups)} caption groups, word-highlight {HILITE_HEX}, strip {W}x{CAP_H}")
print(f"CAP_Y={H - CAP_H - BOTTOM_GAP}")
