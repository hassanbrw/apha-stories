# Editing — video kis tarah kati hui hoti hai

Ye wo qaide hain jo tool khud lagata hai. Sab `config.json` se badle ja
sakte hain.

---

## Hook — pehle 30 second

Yahan sab se zyada log chhod kar jate hain, is liye iske apne qaide hain.

```
0:00 ─ 0:05   avatar (chehra) — 5 second bolta hai, is se zyada nahi
0:05 ─ 0:30   har 2-3 second baad cut (images / stock / avatar)
0:30 se aage   normal — 4-5 second ke shots
```

- Shuru mein **5 second** avatar, phir foran cutaway.
- Uske baad hook khatam hone tak har shot **2-3 second** ka.
- Hook ke baad normal raftaar: 4-5 second ke shots.
- 17 second ka talking head shuru mein = video mar gayi.

```jsonc
"hook": { "seconds": 30, "avatarOpenSeconds": 5, "cutSeconds": 2.5 }
```

---

## Rhythm — kis waqt kya (deterministic)

Slot ki kism **LLM tay nahi karti** (wo har baar alag deti thi aur stock ek
jagah guccha ban jata tha). Ab ek **fixed pattern** hai:

```
A i i S C A i S i A C i i S C ...   (A=avatar  i=image  C=character-image  S=stock)
```

Is ka natija:
- **stock shuru se** aata hai (pehla ~13-15s par, na ke 2 minute baad)
- **har 2-3 image ke baad ek stock** — poori video mein barabar
- **avatar bikhra hua** (kabhi lagataar do avatar nahi)
- ratio khud ~30/50/20 par baith jata hai

Kyunki ye deterministic hai, timeline dobara banane par bhi **wahi** boundaries
aati hain — is liye banayi hui images/stock kabhi orphan nahi hoti (pehle yehi
"images repeat" ki wajah thi).

> Timeline ek dafa banne ke baad **lock** ho jati hai. Agar images ban chuki
> hon to `node run.js --only=timeline` usay dobara nahi banata (warna sab assets
> bekaar ho jayein). Zabardasti: `FORCE_TIMELINE=1` — lekin phir images bhi
> naye sire se banani hongi.

---

## Baqi video

| cheez | kitni der |
|---|---|
| image | 3-4 second |
| stock clip | 4-6 second |
| avatar | poora block, lekin **lagataar do avatar block nahi** |

```jsonc
"shot": { "imageMin": 3, "imageMax": 4, "stockMin": 4, "stockMax": 6, "maxAvatarRun": 1 }
```

---

## Side by side — 2 images ek sath

Beech ki editing mein kabhi kabhi do images aadhi aadhi screen par. Isse
raftaar mehsoos hoti hai aur ek jaisi cutting nahi lagti. **Sirf 5-8 dafa
poori video mein** — bar bar nahi, bikhri hui.

```jsonc
"sideBySide": { "randomCount": 6, "everyNthImage": 0, "gapPx": 8 }
```

- `randomCount: 6` = poori video mein 6 jagah jodi (barabar phaili hui)
- `everyNthImage` sirf tab chalta hai jab `randomCount: 0` ho
- dono `0` = bilkul band

---

## Ratio — kis cheez ka kitna hissa

```jsonc
"ratio": { "avatar": 30, "images": 50, "stock": 20 }
```

Teenon ka jama **100** hona chahiye. Tool khud hisaab lagata hai ke kaunsa
hissa kis kism ka hoga, aur budget se bahar jaye to theek kar deta hai.

Hook aur aakhri baat **hamesha avatar** rehti hai, chahe ratio kuch bhi ho.

---

## Character consistency — wahi banda

Kuch images mein **wahi ek banda** (jo avatar mein hai) — reference tasveer se.

```jsonc
"images": { "characterConsistency": true, "characterShare": 0.30 }
```

- `0.30` = 30% images mein wahi banda, baqi 70% aam visuals (khet, janwar,
  auzaar, mandi)
- ye character images **poori video mein barabar phaili** hoti hain — ek sath
  cluster nahi hotin. Natija: har ~3 aam image ke baad ek character, aur beech
  beech stock footage.
- `characterConsistency: false` = feature bilkul band

Reference tasveer spec mein: `Avatar: avatars/<naam>.png`

---

## Avatar poori screen par ya side mein

```jsonc
"avatarLayout": { "fullScreenShare": 1 }
```

- `1` = har avatar shot poori screen (default)
- `0.5` = aadhe shots right side mein (70% image / 30% avatar)
  — is ke liye **wide avatar** bhi chahiye (thora door se liya hua),
  warna chehra kat jata hai. Spec mein `AvatarWide:` likho.

---

## Motion — smooth, koi shake nahi

Har tasveer par smooth harkat — bari bari **zoom-in, zoom-out, pan-left,
pan-right**. Ye 2x bade canvas par bana kar lanczos se ghatai jati hai, is
liye **shake/jitter bilkul nahi** aata (yehi purani sab se bari shikayat
thi).

```jsonc
"render": { "zoom": 0.12 }
```

- `0.12` = halki harkat (thumbnail-jaise still nahi, jhatke wale bhi nahi)
- `0` = tasveerein bilkul static (koi motion hi na chahiye to)
- **kabhi jhatka nahi** — agar shake dikhe to ye bug hai, `zoom` ka masla nahi

---

## Awaaz aur lip-sync

Har clip **apni sahi awaaz** khud le jata hai:

- **avatar** — HeyGen ki apni awaaz (bilkul synced, hont aur awaaz ek sath)
- **image / stock** — voiceover ka theek us waqt ka tukra

Pehle sab clips mute the aur upar ek master voiceover chalta tha — HeyGen ki
chhoti latency master se match nahi karti thi aur hont peeche/aage lagte the.
Ab har clip apni awaaz ke sath jaata hai, is liye lip-sync kabhi nahi phisalta.

Voice badalni ho: `config.json` → `voice.id` (ya spec mein `Voice:`). Boodha
dheema aadmi chahiye to `speed` `"0.9"` kar do aur koi mature voice id chuno.

---

## Typography

Default mein **band**. Chahiye to:

```jsonc
"captions": { "enabled": true, "position": "left-bottom" }
```

Captions har lafz ki asli timing par lagti hain (andaze se nahi) — voiceover
ke sath jo `words.json` aati hai usi se.
