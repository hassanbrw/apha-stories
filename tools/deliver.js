// istemal: node tools/deliver.js <video-id>
// work/<video-id>/ ka finished package (final.mp4, thumbnail, title-
// description.txt) Google Drive par upload karta hai.
const U = require('../lib/util.js');
const { deliverVideo } = require('../lib/gdrive.js');

const id = process.argv[2];
if (!id) { U.bad('istemal: node tools/deliver.js <video-id>'); process.exit(1); }

const wd = U.workDir(id);
U.log(`   Google Drive par upload ho raha hai: ${id}...`);
try {
  const target = deliverVideo(id, wd);
  U.ok(`Drive par pahunch gaya: ${target}`);
} catch (e) {
  U.bad(e.message);
  process.exit(1);
}
