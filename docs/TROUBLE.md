# Kuch toot jaye to

Pehla qadam hamesha:

```bash
node setup/check.js
```

---

## "Gemini browser login nahi hua"

Google ka login khatam ho gaya (kuch hafton baad hota hai).

```bash
node setup/gemini-login.js
```

Login kar ke browser band kar do, phir:

```bash
node run.js --video=<id> --from=6
```

Jo images pehle ban chuki hain wo dobara nahi banti — sirf baqi banti hain.

---

## HeyGen login page dikha raha hai jabke login kiya tha

```bash
node setup/heygen-setup.js
```

2FA ka code bhi daalna hota hai. Phir:

```bash
node run.js --video=<id> --only=avatar
```

> **Kyun hota hai:** Playwright by default `--use-mock-keychain` aur
> `--password-store=basic` lagata hai, jin ke sath Chrome Keychain se cookies
> decrypt nahi kar pata. Hamare scripts ye args hata dete hain. Agar tum apna
> koi script likho to tum bhi hatana.

---

## Avatar bana lekin bolta nahi ("No script")

Audio scene par nahi lagi. Wajah aksar ye hoti hai ke **Confirm Audio** wale
modal par "Add audio" ke bajaye "Add scene" dab gaya.

Tool ab sirf exact `Add audio` dabata hai. Phir bhi ho to
`browser/heygen-ui/2-audio.png` dekho.

---

## Stock clips mein banda baat kar raha hai / likhai aa rahi hai

Gemini verify band hoga:

```jsonc
"stock": { "verifyWithGemini": true }
```

Kuch clips phir bhi nikal jayen to unhe mita do aur wahi stage dobara chalao —
mitayi hui video dobara nahi aayegi (`stock/used.json` mein darj ho jati hai):

```bash
rm work/<id>/stock/stk_00189_00193.mp4
node run.js --video=<id> --only=stock
```

---

## "Requested format is not available"

Us YouTube video par 1080p hai hi nahi. Ye masla nahi — tool khud agla
candidate le leta hai.

---

## Video narration se aage/peeche chal rahi hai

Kisi slot ka clip us ki poori lambai ka nahi bana. Render ab ye khud pakad
leta hai aur ruk jata hai:

```
clips ki lambai ghalat: 822s vs 841s — render rok diya
```

Aisa ho to us stage ko dobara chalao jis ke assets kam hain (`--only=stock`
ya `--only=images`), phir `--only=render --redo`.

---

## Disk bhar gayi

`work/<id>/render/` mein beech ke clips hote hain — video ban jane ke baad
inki zaroorat nahi:

```bash
rm -rf work/<id>/render
```

Ek video ~2-3 GB beech ka maal banati hai.

---

## Script Hindi/Urdu mein aa gaya

Model kabhi kabhi zubaan badal deta hai. Stage 1 ye pakad kar dobara English
mein likhwata hai. Phir bhi ho to:

```bash
node run.js --video=<id> --only=script --redo
```

---

## Kuch bhi ajeeb ho

Har stage ka log `logs/` mein hai. Claude se kaho:

> **`logs/` dekho aur batao kya ghalat hua**
