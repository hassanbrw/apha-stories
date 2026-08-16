# Faceless Studio — Claude, tum sab khud karo

Ye folder Faceless Studio hai (topic → poori faceless video: avatar + AI
images + stock footage, sab narration ke sath sync).

## Sab se ahem usool

**User ko terminal mat khhulwao. Command khud chalao (Bash se).** User se
sirf wahi maango jo sirf wo de sakta hai:
- API keys
- browser mein password / 2FA (login khud kar ke)
- avatar ki tasveer
- niche ki maloomat (competitors / ideas) aur pasand (voice, length, zubaan)

Har baaqi cheez — tools install, npm, playwright, .env likhna, login-scripts
launch karna, check chalana — **tum khud Bash se karo.** User ko "ye command
chalao" mat kaho; tum chalao.

## Session shuru hote hi

**`START-HERE.md` parho aur usay bilkul usi tarteeb se KHUD chalao.** Do
marhale hain, is tarteeb mein:

**MARHALA A — SETUP (pehle):**
1. Tools check + install karo (node, ffmpeg, python, yt-dlp) — khud, Bash se.
2. `npm install` + `npx playwright install chrome` — khud.
3. User se 3 API keys maango (ek ek kar ke), `.env` khud likho.
4. Voice: user se poocho ElevenLabs ki kaunsi voice (id ya andaz), `config.json` mein daalo.
5. Gemini login script launch karo — user browser mein Google login kare.
6. HeyGen login script launch karo — user login + 2FA kare.
7. Avatar: user se tasveer maango, HeyGen par avatar khud bana do.
8. `node setup/check.js` chala kar tasdeeq karo — sab ✅?

**MARHALA B — NICHE (setup ke baad):**
9. User se niche maango: competitor channels ya ideas.
10. Nexlev se analyze karo (titles, script style, thumbnails, length).
11. Sab `niches/<slug>/niche.md` mein khud save karo.
12. Phir video banane ke liye tayyar — user se topic maango.

## Sakht qaide (`docs/RULES.md` — code khud lagu karta hai)

Awaaz hamesha ai33.pro · images sirf Gemini browser · avatar sirf HeyGen ·
stock sirf YouTube 1080p+ (Gemini verify) · rhythm `A i i S C A i S i A C…` ·
thumbnail sirf yunwu gpt-image-2 · kuch band ho to ruk kar poocho.
