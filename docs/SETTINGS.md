# Settings — `config.json` ki har cheez

Kuch badalna ho to **sirf yahi file**. Code chhune ki zaroorat nahi.

---

## Final video ka hissa

```jsonc
"ratio": { "avatar": 30, "images": 50, "stock": 20 }
```

Teenon ka jama 100. `check.js` galat jama pakad leta hai.

Misalein:
- zyada chehra: `40 / 45 / 15`
- zyada asli footage: `20 / 45 / 35`
- bilkul faceless (koi avatar nahi): `0 / 65 / 35`

---

## Awaaz

```jsonc
"voice": { "id": "elevenlabs_bIHbv24MWmeRgasZH58o", "speed": "1.0" }
```

ai33.pro ki koi bhi voice id chalegi. `speed` `"0.9"` (dheemi) se `"1.1"`
(tez) tak.

---

## Kaunsa model kya likhe

```jsonc
"models": {
  "script":   ["or:deepseek/deepseek-v4-pro", "or:deepseek/deepseek-v3.2"],
  "prompts":  ["or:deepseek/deepseek-v4-pro"],
  "timeline": ["or:deepseek/deepseek-v4-pro"],
  "facts":    ["or:deepseek/deepseek-v4-pro:online"],
  "video":    ["gemini-2.5-flash"],
  "thumbnail":["gpt-image-2"]
}
```

- Har jagah **list** hai — pehla na chale to agla khud chal jata hai
- `or:` = OpenRouter, baqi yunwu
- `:online` = wo model web search kar sakta hai (fact check ke liye)
- **`video`** hamesha `gemini-2.5-flash` — yehi stock clips dekhti hai

DeepSeek ke bajaye kuch aur chahiye? Bas naam badal do:
```jsonc
"script": ["or:anthropic/claude-sonnet-4", "or:deepseek/deepseek-v4-pro"]
```

---

## Claude khud kya likhta hai

```jsonc
"claudeWrites": {
  "hook": true,
  "humanPass": true,
  "humanPassMaxWords": 500,
  "stockKeywords": true
}
```

| | |
|---|---|
| `hook` | pehle 90-120 lafz Claude naye likhta hai (models ke hook boring hote hain) |
| `humanPass` | poore script mein zyada se zyada 500 lafz badal kar insani lehja deta hai |
| `stockKeywords` | stock footage ke search terms Claude likhta hai — model ke terms se YouTube par tutorial/vlog aate hain, asli footage nahi |

`false` kar do to model hi sab likh dega (tez, lekin thora phika).

Jab ye on hon, pipeline ruk kar `work/<id>/CLAUDE-TODO.md` aur
`CLAUDE-KEYWORDS.md` chhod deti hai — Claude wahi parh kar kaam karta hai
aur aage chala deta hai.

---

## Character consistency

```jsonc
"images": { "characterConsistency": true, "characterShare": 0.5 }
```

- `characterShare: 0.5` = aadhi images mein **wahi ek banda**
  (Gemini tool ke character mode se, reference tasveer ke sath)
- `0` = koi nahi · `1` = sab
- `characterConsistency: false` = feature bilkul band

Reference tasveer video ki spec mein: `Avatar: avatars/<naam>.png`

---

## Shots ki lambai aur hook

Poori tafseel: [EDITING.md](EDITING.md)

```jsonc
"shot":        { "imageMin": 3, "imageMax": 4, "stockMin": 4, "stockMax": 6, "maxAvatarRun": 1 },
"hook":        { "seconds": 30, "avatarOpenSeconds": 4, "cutSeconds": 2.5 },
"sideBySide":  { "everyNthImage": 9, "gapPx": 8 }
```

---

## Stock footage

```jsonc
"stock": {
  "minHeight": 1080,
  "maxClipSeconds": 6,
  "candidatesPerSlot": 5,
  "uniqueVideosOnly": true,
  "verifyWithGemini": true
}
```

- `minHeight` 1080 se kam mat karo — chhoti video 1080p par phaila kar
  dhundhli lagti hai
- `verifyWithGemini: false` tez hai lekin talking head aur watermark aa
  jayenge (**mashwara nahi**)

---

## Typography

```jsonc
"captions": { "enabled": false, "position": "left-bottom", "style": "typewriter" }
```

---

## Render

```jsonc
"render": { "crf": 21, "preset": "veryfast", "zoom": 0.10 }
```

- `crf` chhota = behtar quality + bari file (18 = bohat achhi, 25 = chhoti)
- `zoom` = images par kitna zoom (0.10 = 10%, halka rakho)

---

## Raftaar

```jsonc
"concurrency": { "images": 1, "stock": 3, "render": 4 }
```

Purana ya dheema laptop ho to `stock` aur `render` kam kar do.
`images` hamesha 1 — Gemini ka ek hi browser chalta hai.
