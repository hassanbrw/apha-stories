# Faceless Studio

Topic likho → 15 minute ki video mil jaye. Avatar bolta hua, AI images,
asli stock footage, sab narration ke sath sync.

Kisi bhi niche ke liye — Amish farming, true crime, space, kuch bhi.

---

## Sab se pehle (sirf ek dafa)

Terminal is folder mein khol kar likho:

```
claude
```

Phir Claude se kaho:

> **START-HERE.md parho aur mujhe set up karo**

Claude khud tumse sawal poochega — tumhari niche kya hai, competitors kaun
hain, kaunsi API keys hain — aur baqi sab khud kar dega.

Sirf teen kaam tumhe khud karne padenge (kyunki password tumhara hai):

1. Gemini mein Google login
2. HeyGen mein login
3. Apne avatar ki tasveer upload

Claude tumhe bata dega kab.

---

## Video banana

```bash
node run.js --new "Amish farmers making $5k a month from one acre"
```

Bas. Baqi sab khud hota hai:

| | |
|---|---|
| script | DeepSeek likhta hai, **hook aur insani lehja Claude** |
| voiceover | ai33.pro — sath mein har lafz ki timing |
| planning | narration ko avatar / image / stock mein baanta jata hai |
| images | Gemini (browser) — aadhi mein wahi ek banda |
| avatar | HeyGen — bolta hua, hont narration se milte hue |
| stock | YouTube — har clip alag video se, 1080p+, Gemini check karti hai |
| jodna | ffmpeg → `work/<id>/final.mp4` |
| thumbnail | 3 variants |

> **Tez:** voiceover (SRT) bante hi **images + stock scraping + avatar teenon
> ek sath** chalte hain (ek doosre ka intezaar nahi karte) — is se poori video
> ghanton ke bajaye kam waqt mein banti hai.

Beech mein ruk jaye to wahin se chalti hai:

```bash
node run.js --list                       # kahan tak bani
node run.js --video=<id> --from=6        # 6 se aage
node run.js --video=<id> --only=stock    # sirf ek hissa
```

---

## Kuch badalna ho

Sab kuch **`config.json`** mein hai. Code khholne ki zaroorat nahi.

```jsonc
"ratio":  { "avatar": 30, "images": 50, "stock": 20 }   // final video ka hissa
"voice":  { "id": "elevenlabs_..." }                    // apni voice
"images": { "characterShare": 0.5 }                     // wahi banda kitni images mein
"models": { "script": ["or:deepseek/deepseek-v4-pro"] } // koi aur model
```

Har setting ki tafseel: **[docs/SETTINGS.md](docs/SETTINGS.md)**

---

## Docs

| file | kis liye |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | kya install karna hai (Mac + Windows) |
| [docs/SETTINGS.md](docs/SETTINGS.md) | har setting ka matlab |
| [docs/EDITING.md](docs/EDITING.md) | video kaisi kati hui hoti hai |
| [docs/RULES.md](docs/RULES.md) | wo qaide jo tool khud lagu karta hai |
| [docs/TROUBLE.md](docs/TROUBLE.md) | kuch toot jaye to |
| [START-HERE.md](START-HERE.md) | Claude ke liye — tum ise parhne ki zaroorat nahi |

---

## Sab theek hai ya nahi

```bash
node setup/check.js
```

Har ❌ ke sath ye bhi likha hota hai ke usay theek kaise karna hai.
