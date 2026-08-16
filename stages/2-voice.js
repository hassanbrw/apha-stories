// ============================================================
//  STAGE 2 — voiceover + SRT + har lafz ka waqt (Kokoro, local, FREE)
//
//  Kokoro sirf audio deta hai, timing nahi (ai33 deta tha — is liye
//  tools/kokoro_tts.py khud faster-whisper se word-level timing WAPAS
//  nikalta hai). Ek hi Python call teeno banata hai:
//     voice/voiceover.mp3   — poora narration
//     voice/voiceover.srt   — jumla ba jumla waqt (timeline isi par khara hai)
//     voice/words.json      — HAR lafz ka start/end (word-highlight captions)
//
//  Koi API key, koi per-call cost — sab is machine par local chalta hai.
// ============================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const U = require('../lib/util.js');

module.exports = async function (spec, cfg, st) {
  const id = spec.id;
  const vdir = U.p(id, 'voice');
  fs.mkdirSync(vdir, { recursive: true });

  const outMp3 = path.join(vdir, 'voiceover.mp3');
  const outSrt = path.join(vdir, 'voiceover.srt');
  const outWords = path.join(vdir, 'words.json');

  if (fs.existsSync(outMp3) && fs.existsSync(outSrt) && fs.existsSync(outWords) && U.seconds(outMp3) > 30) {
    U.log('   voiceover pehle se maujood — skip');
  } else {
    const voice = spec.voice || cfg.voice.id;
    const speed = spec.voicespeed || cfg.voice.speed;
    const whisperModel = cfg.voice.whisperModel || 'small';
    U.log(`   Kokoro (local, voice=${voice}) + Whisper (${whisperModel}) se voiceover ban raha hai...`);
    U.log('   (CPU par chal raha hai — pehli dafa Whisper model download hoga)');
    // 90 min pehle kaafi nahi tha — 60-min video ke liye TTS generation
    // (37 chunks) hi kabhi kabhi 90 min le leta hai CPU par, Whisper alag se.
    // kokoro_tts.py khud resumable hai (chunks cache hote hain), is liye
    // dobara chalane par bhi bacha hua kaam hi hota hai — phir bhi budget
    // zyada rakhte hain taake poora fresh run bhi (kabhi kabhi zaroori)
    // beech mein na kata jaye.
    execFileSync('python', [
      path.join(U.ROOT, 'tools', 'kokoro_tts.py'),
      U.workDir(id), String(voice), String(speed), String(whisperModel),
    ], { stdio: 'inherit', timeout: 14400000 });
  }

  const total = U.seconds(outMp3);
  if (!total) throw new Error('voiceover.mp3 nahi bani');
  const words = JSON.parse(fs.readFileSync(outWords, 'utf8'));
  const cuesCount = (fs.readFileSync(outSrt, 'utf8').match(/-->/g) || []).length;

  st.meta.voiceSeconds = Math.round(total);
  st.meta.srtCues = cuesCount;
  st.meta.wordCount = words.length;
  U.ok(`voiceover.mp3 — ${Math.floor(total / 60)}m ${Math.round(total % 60)}s`);
  U.ok(`voiceover.srt — ${cuesCount} cues`);
  U.ok(`words.json — ${words.length} lafz ke timings`);
  if (!words.length) throw new Error('words.json khaali — Whisper timing nahi ban saki; timeline nahi ban sakti');
  return true;
};
