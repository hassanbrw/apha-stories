# Sakht qaide

Ye sirf mashware nahi — **code inhe khud lagu karta hai**. Todne ki koshish
par error aata hai, chup chaap koi doosra raasta nahi liya jata.

---

## 0. AWAAZ — hamesha ai33.pro, kabhi HeyGen ki nahi

Poore video ki awaaz **sirf ai33.pro voiceover** hai — ek hi continuous track,
shuru se aakhir tak. Avatar ke hisson par bhi **ai33 ki awaaz** chalti hai,
**HeyGen ki apni awaaz kabhi nahi**.

Wajah: HeyGen apni awaaz ko re-encode/pitch-shift kar deta hai, to avatar aur
baaki video ki awaaz alag lagti (do voice). Aur per-clip audio kaatne se
glitch aata tha. Is liye:

- HeyGen ka avatar sirf **video** (bolta hua chehra) deta hai
- awaaz poore video par ek hi ai33 file se, ek dafa mux hoti hai
- koi cut nahi = koi glitch nahi, aur pitch bilkul ek jaisa

Lip-sync isi liye theek rehta hai kyunki avatar clip apne sahi waqt par baithta
hai aur ai33 awaaz wahi narration hai jis par HeyGen ne hont banaye the.

---

## 1. Images — sirf Gemini browser tool

Images **hamesha** Gemini ke browser tool se banti hain
(`tools/gemini`, browser automation).

**Kabhi nahi:** koi paid image API (yunwu, OpenAI, Replicate — kuch bhi).

Login na ho to pipeline **ruk jati hai** aur ye kehti hai:

```
Gemini browser login nahi hua.
   chalao:  node setup/gemini-login.js
```

Wo API par nahi chali jati. Ye jaan boojh kar hai — ek dafa aisa hua tha aur
sainkron images ka bill bana tha.

---

## 2. Avatar — sirf HeyGen browser

- `my-avatars` → avatar → look → **Build scene-by-scene**
- voiceover ka tukra **Upload audio** se lagta hai (page ke chhupe hue file
  inputs CSV/Excel ke hain — un mein mp3 gum ho jata hai)
- **Confirm Audio** modal par sirf **"Add audio"** — "Add scene" nahi
- Motion Engine **Avatar III** (yehi lip sync karta hai; Avatar IV generic
  motion hai). Lagane ke baad tasdeeq hoti hai.
- **Render Scene** dabta hai — **"Generate" kabhi nahi**
- render hone par preview ka mp4 URL DOM se utha kar download hota hai

Ek video ke liye **ek hi render** hota hai: sab avatar tukron ki audio jod
kar bheji jati hai, phir video wapas tukron mein kat jati hai. 16 alag render
mein ghante lagte hain.

---

## 3. Stock footage — YouTube, SAKHT sharaton ke sath

| | |
|---|---|
| kahan se | YouTube (`yt-dlp`) |
| quality | **1080p ya behtar** — is se kam **kabhi nahi** (chhoti video 1080p par phaila kar dhundhli lagti hai) |
| har clip | **alag video se** (copyright) — `stock/used.json` ledger rakhta hai |
| lambai | 4-6 second |
| mizaaj | **neat, clean, aur narration se relevant** |

Download aur trim ke **baad** Gemini (`gemini-2.5-flash`) us **trimmed clip
ko dekhti hai** — jo asal mein video mein jayegi — aur clip **reject** kar deti
hai agar in mein se **koi ek bhi** cheez ho:

- ❌ koi camera ke saamne **baat kar raha** ho (talking head, vlog, interview, presenter)
- ❌ **watermark**, logo, ya screen par koi **likhai** / captions / "subscribe"
- ❌ split screen ya picture-in-picture
- ❌ screen recording, tasveeron ki slideshow, ya cartoon/animation
- ❌ narration se **koi taalluq na** ho

Reject hone par agla candidate azmaya jata hai (5 tak). Sirf chhota kona-logo
gawara hai. **Ye qaide narm nahi karne** — `config.json` → `stock` se sirf
`minHeight`/`maxClipSeconds` badle ja sakte hain, verify hamesha on rakho.

---

## 4. Thumbnail — yunwu `gpt-image-2`

Yehi **wahid** cheez hai jo API se banti hai. 3 variants:

1. bold — banda ek taraf, ishara karta hua, cheez doosri taraf, text ki jagah
2. split — aadha cheez, aadha banda, alag alag rang
3. cinematic — saaf, safe option

---

## 5. Voiceover — ai33.pro

Sath mein **SRT + har lafz ki timing** aati hai. Poora plan usi par bana
hai — kisi cheez ka waqt andaze se tay nahi hota.

---

## 6. RHYTHM — tay-shuda tarteeb (bahut zaroori)

Video mein shots isi tarteeb se aate hain — LLM ise nahi badal sakta
(deterministic, `stages/3-timeline.js`):

```
A  i  i  S  C  A  i  S  i  A  C  i  i  S  C  A  i  S  i  A  ...
```

- **A** = avatar (bolta hua chehra)
- **i** = normal image
- **C** = character image (wahi banda) — kism ke lehaz se ye bhi image
- **S** = stock footage

Is se ye pakka hota hai:

- **stock SHURU se** aata hai (pehla ~13-15s par, na ke 2 minute baad)
- **har 2-3 image ke baad ek stock** — poori video mein barabar bikhra
- **character/image/stock/avatar sab mix** — koi cheez guccha nahi
- **avatar thora kam** (10 mein 2 → ~20%), aur kabhi lagataar do avatar nahi

Ratio badalna ho to `config.json` → `ratio`, aur PATTERN
`stages/3-timeline.js` mein — lekin **A (avatar) zyada mat karo**, kam theek hai.

### HOOK (pehle 30 second) ka apna qaida

```
0:00 ─ 0:05   avatar bolta hai (5 second)
0:05 ─ 0:30   har 2-3 second baad cut (image / stock / avatar)
0:30 se aage  normal — 4-5 second ke shots
```

---

## 7. Bina poochhe bara kharcha nahi

Koi browser tool logged out ho, ya kuch band ho —
**ruk kar poocho**. Apne aap mehnga raasta mat lo.
