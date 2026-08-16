# START-HERE — Claude ka playbook (sab khud chalao)

> Ye tumhare (Claude ke) liye hai. **User ko kuch install/type mat karwao.**
> Har command KHUD Bash se chalao. User se sirf ye maango: API keys,
> browser password/2FA (login khud kar ke), avatar tasveer, niche maloomat.
> Har qadam ke baad chhota update do ("node aa gaya", "ffmpeg install ho raha").

---

# MARHALA A — SETUP (pehle ye, poora)

## A0. OS pehchano
```bash
uname -s   # Darwin = Mac, Linux = Linux
```
Windows par ye fail hoga → maan lo Windows hai.

## A1. Tools check karo (kya pehle se hai)
```bash
node -v; ffmpeg -version | head -1; python3 --version; yt-dlp --version
```
Jo "command not found" de, wahi install karna hai (agla qadam). Jo mil jaye,
uski line skip karo — dobara install mat karo.

## A2. Jo missing hai, KHUD install karo

**Mac** — pehle Homebrew (agar `brew` na ho):
```bash
which brew || echo NEED_BREW
```
`NEED_BREW` aaye to ye chalao (ye user ka Mac password maangega — us waqt
user ko bolo "apna Mac password terminal mein daal dena", baaki tum karo):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Phir jo tools missing the:
```bash
brew install node ffmpeg python3
pip3 install -U yt-dlp
```

**Windows** — jo missing ho:
```bash
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
pip install -U yt-dlp
```
Windows par install ke baad naya shell chahiye ho sakta — agar `node -v` phir
bhi na chale to user ko bolo terminal band kar ke Claude dobara khhole.

## A3. Project ki cheezein (KHUD)
```bash
npm install
npx playwright install chrome
```

## A4. API keys (user se maango, .env KHUD likho)
User se ek ek kar ke maango (agar wo "tumhari wali rakho" kahe to mana karo —
keys har kisi ki apni hoti hain):
- `OPENROUTER_KEY`  (script + image prompts — openrouter.ai/keys)
- `AI33_KEY`  (voiceover — ai33.pro)
- `YUNWU_KEY`  (stock verify + thumbnail — yunwu.ai)

Phir `.env` KHUD likho (user ko file edit mat karwao):
```bash
cp -n .env.example .env
```
aur teenon lines ko user ki di hui keys se badal do (Edit/Write se).

## A5. Voice (ElevenLabs) — user se poocho
Poocho: "avatar/narration ki awaaz kaisi ho? ElevenLabs ki koi voice id hai,
ya main kuch options doon (boodha/jawan, mard/aurat, dheemi/tez)?"
Voice id `config.json` → `voice.id` mein daal do, raftaar `voice.speed` mein.
(ai33 par ElevenLabs voices milti hain — `elevenlabs_<id>`.)

## A6. Gemini login (images ke liye)
Launch KHUD karo:
```bash
node setup/gemini-login.js
```
User ko bolo: "browser khul gaya — Google se login karo, 'Continue' dabao,
tool khul jaye to browser band kar dena." Wait karo jab tak wo confirm kare.

## A7. HeyGen login (avatar ke liye)
```bash
node setup/heygen-setup.js
```
User ko bolo: "HeyGen mein login karo (2FA code bhi), 'My Avatars' khul jaye
to band kar do." Wait karo.

## A8. Avatar banao
User se avatar ki tasveer maango (saaf chehra, 16:9). Usay `avatars/` mein
rakho, phir KHUD:
```bash
node setup/heygen-setup.js --photo avatars/<file> --name <Naam>
```
Ho jaye to `HeyGenAvatar: <Naam>` aur `Avatar: avatars/<file>` yaad rakho —
video specs mein lagega.

## A9. Setup ki tasdeeq
```bash
node setup/check.js
```
Sab ✅ na ho to jo ❌ hai wahi theek karo (uska hal usi ke neeche likha hota).
**Sab ✅ hone tak MARHALA B shuru mat karo.**

---

# MARHALA B — NICHE (setup ke baad)

## B1. User se maango (ek ek kar ke)
1. "Aap ki niche kya hai?" (misal: Amish farming, true crime, space)
2. "2-3 competitor channels ke link do — ya batao kaisi videos dimagh mein hain."
3. "Video kitni lambi? (10/15/20 min)"
4. "Zubaan? Nazareen kaun?"

## B2. Competitors analyze karo (Nexlev)
Nexlev MCP se (agar juda hai):
- `youtube_channel_outliers` / `youtube_channel_videos` — kaunsi videos chal rahi, titles ka andaz
- `get_video_transcript` (1-2 video) — script ka lehja, hook ka tareeqa
- `get_similar_thumbnails` — thumbnail ka style
Ek dafa mein 30 se zyada channel calls mat karo (Nexlev 24-ghante cap).
Nexlev na ho to unke diye links khud dekho, ya user se 5-10 chalti video ke
titles mango.

## B3. Niche yaddasht KHUD save karo
Banao `niches/<slug>/niche.md` — ismein:
- competitors + kya chal raha
- **titles ka andaz** (formulas, asli misalon ke sath)
- **script ka andaz** (hook, lehja, structure)
- **thumbnails ka andaz** (composition, rang, kitna text)
- **video length**, zubaan, nazareen
- 10-20 topic ideas

Har niche ki apni file. Niche badle to nayi file, purani mat chhero.

## B4. Video banane ke liye tayyar
User se topic maango, phir:
```bash
node run.js --new "<topic>"
```
Bani hui video `work/<id>/final.mp4`, thumbnails `work/<id>/thumbnail/`.

---

## Sakht qaide (`docs/RULES.md`)
Awaaz ai33.pro · images Gemini browser · avatar HeyGen · stock YouTube 1080p+
verify · rhythm `A i i S C A i S i A C…` · thumbnail yunwu gpt-image-2 · kuch
band ho to ruk kar user se poocho, apne aap mehnga raasta mat lo.
