# Title & Description Reference — Lily's Romance Library

Full corpus fetched 2026-08-18: all 96 videos from @lilywritesstuff (channel
UCdqTXO6-UJmxfJ8G3fpBNJg), sorted by popularity. Raw data saved in
`title-research/lily_all_titles.json` (title, view count, length, publish
date for every video) and `title-research/all_titles_plain.txt` (plain list).
Two full descriptions pulled for structural analysis (see below).

This file is the reference for **generating our own titles and descriptions**
going forward — every new video should be checked against the rules at the
bottom before being called final.

---

## 1. Title length

Measured across all 96 titles:

| Metric | Value |
|---|---|
| Character count | 50–100, avg **81.3** |
| Word count | 8–21, avg **15.3** |

This is deliberately long for a YouTube title — longer than the "keep it
under 60-70 characters" advice that applies to most YouTube content. These
are long-form story/podcast videos where the title itself functions as a
complete micro-hook (setup + twist), not just a label.

## 2. Structure — the dominant pattern is a two-part dash sentence

**49% of all titles (47/96) use a `[Setup] - [Twist/reveal]` structure** —
one clause establishing the ordinary/dangerous situation, a literal
` - ` (space-dash-space), then the twist that recontextualizes it:

> "She Pretended to be Mute for 8 years to Avoid Being Claimed - Until the Alpha King found out..."
> "No One Could Calm the Alpha King's Twin Pups - Until The Omega Maid They All Rejected Did This"
> "100 princesses compete for the Alpha King's hand at the ball - but all he wants is his poor maid"
> "Every bride the Alpha King takes is dead within a week - so he's shocked when the 7th survives"

The second half almost always starts with one of a small set of pivot words:
**"until," "but," "so," "-then"** — these are the twist-hinge words. Nothing
fancier than that; the mechanism is always "ordinary/bad situation" → pivot
word → "the actual hook."

**A second, shorter format exists for branded/series entries** — these read
as catalog-style titles, not narrative hooks:
> "The Alpha's Rejected Mate | Werewolf Shifter Romance Audiobook"
> "Kidnapped by a ruthless Alpha | Werewolf Shifter Romance (INCOMPLETE)"

These are shorter (8-10 words), use `|` to separate the story title from a
genre/format tag, and skip the narrative setup entirely. They appear to be
older-style or lower-effort uploads — the two-part narrative-hook format
above is what actually drives the top-performing videos (every video over
400K views uses the dash-twist structure, none use the pipe-branded format).
**Use the dash-twist format, not the pipe-branded one.**

**Other structural markers found:**
- **Ellipsis (`...`)** used 19/96 times, almost always trailing off the END
  of a title to imply "there's more" — never mid-title.
- **Parentheses** used only 4/96 times, exclusively for sequel/format tags:
  "(PART 2)", "(Book Trailer)", "(INCOMPLETE)" — never for narrative content.
- **Question marks: 0/96.** Confirms the standing rule — never phrase a
  title as a question.
- **Colons: 2/96.** Rare; when present it's for a quoted-dialogue payoff
  ("The Groom Left Her at the Altar So The Alpha King stepped forward:
  'Marry me Instead'").
- **Quoted dialogue inside the title**: used a handful of times as the
  payoff/twist itself, e.g. `'I Accept Your REJECTION Alpha' - The Court
  went silent, and the Alpha King Lost Control` and `She Drunkenly Asks the
  Alpha King to marry her as a Joke - He says "No Take backs"`. A quoted
  line works well as either the setup OR the twist half.

## 3. Wording level

Same plain, middle-school-reading-level vocabulary the script-comparison
report already found in the competitor's prose — titles are no exception.
No literary/uncommon words anywhere in the corpus. Common recurring content
words: **Alpha King, claimed/claims, rejected, mate, bride, secret,
survives/survived, curse, ruthless, obsessed.**

**Capitalization: Title Case, but loosely applied.** ~56% of words are
capitalized on average — content words (nouns, verbs, adjectives) are
capitalized, small function words (the, a, an, to, of, at, is, he, she, his,
her) are usually left lowercase *unless* they open the sentence. Not
strict AP/Chicago title case — closer to "cap the important words,
don't sweat the rest." Example: "She kisses a beggar at the mating
ceremony to avoid being claimed - unaware he's the Alpha King" — "kisses,"
"beggar," "mating," "ceremony," "claimed," "Alpha King" capped or not
somewhat inconsistently; don't over-engineer this, approximate it.

## 4. Openers — over half of all titles start one of two ways

| Opener | Count |
|---|---|
| "She" | 25/96 |
| "The" | 23/96 |
| "He" / "He's" | 5/96 |
| "No One" | 3/96 |
| "I" | 3/96 |
| "Struggling [noun]" | 3/96 |
| Everything else | scattered |

**"She [verb]..." and "The Alpha King/Alpha ..." together account for half
of all titles.** When in doubt, open with the heroine's action ("She
survives...", "She hides...", "She fled...") or the hero's title ("The
Alpha King...", "The Alpha's..."). Numeric openers also recur ("100
princesses...", "For 7 years...") as a hook device — a specific number
reads as more concrete/credible than a vague timeframe.

## 5. Description structure (from full-text pulls on 2 videos, consistent pattern)

Every description follows the same template, in this order:

1. **One-sentence hook** — restates the title's premise in a full sentence,
   sometimes adding one new detail. ("She asks the Alpha King for one night
   of passion, thinking it will be her last... but is shocked to be alive
   the next day in the werewolf shifter romance")
2. **"If you love X, Y, Z... this story is for you" paragraph** — a trope
   checklist sentence (accidental marriage, fated mates, forced proximity,
   slow burn, possessive hero, etc.) written as direct reader address, for
   both human hook and SEO keyword density.
3. **"Summary" heading**, then a short (150-300 word) prose retelling of the
   opening — functionally identical to what our pipeline already calls the
   "teaser." Uses short paragraphs, sometimes one-line paragraphs for
   punch ("Hers is almost up." / "But then morning comes." / "And Audra is
   still there.") — heavier use of single-sentence paragraph breaks than
   the narration style used inside the actual story.
4. **A second "if your favorite romances combine X, Y, Z... you're going to
   want to stay until the end" paragraph** — same trope-checklist technique
   as #2, bookending the summary.
5. **"ABOUT THIS CHANNEL"** branding block (static, same every video).
6. **Patreon link** (static).
7. **"CREDITS"** block — writer, AI voice tool, visuals, copyright/anti-repost
   notice (static).
8. **Timestamped chapter list** — each chapter gets a one-line hook-style
   description, not a plain label (e.g. "6:33 She asks the Alpha King to
   spend the night with her but neither expects the mating bond to form" —
   not "Chapter 2"). These read like mini cold-opens for each act.

## 6. Thumbnail must be generated FROM the title, not independently

Standing note from the user (2026-08-18): thumbnails need to depict the
**specific visual moment the title promises**, not a generic "cold Alpha
King + heroine" shot. If the title's twist is "he's shocked when the 7th
survives," the thumbnail should show that specific beat (a stunned Alpha
King, a bride very visibly alive/upright when six graves/veils imply she
shouldn't be) — not a generic confrontation shot. **Practical order going
forward: decide the title first, then write the thumbnail prompt to depict
that title's exact hook**, rather than generating thumbnail and title as
unrelated steps (which is what the pipeline has been doing until now — the
thumbnail prompt so far has only ever been built from character
descriptions, never from the title).

---

## Generation rules (apply to every new video going forward)

1. **Structure**: `[Setup clause, present tense] - [pivot word: until/but/so] [twist clause]`. 15-21 words, 50-100 characters total.
2. **Open with "She [verb]..."** (heroine's action) or **"The Alpha King/Alpha's..."** — these two openers cover half of what works. A number-based opener ("For 7 years...", "100 princesses...") is a strong third option when the story has a concrete number worth naming.
3. **No question marks, ever.**
4. Ellipsis only at the very end, only if the title benefits from an implied "there's more."
5. Quoted dialogue is a legitimate twist/payoff device — use a character's actual line if the script has a strong one.
6. Title Case on content words, lowercase small function words, don't over-polish it — a slightly inconsistent cap pattern is authentic to the corpus, not a mistake to fix.
7. **Description**: hook sentence → trope-checklist paragraph → "Summary" (reuse/lightly adapt the script's own teaser) → second trope-checklist paragraph → static About/Patreon/Credits block → timestamped chapters written as mini-hooks, not labels.
8. **Thumbnail prompt must be derived from the finalized title's specific twist**, not generated independently from character descriptions alone.
