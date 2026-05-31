const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("=== SYSTEM DIAGNOSTIC START ===");

let ytdlpOk = false;
let ffmpegOk = false;

// 1. Check yt-dlp
try {
  const ytdlpVer = execSync('yt-dlp --version').toString().trim();
  console.log(`[✔] yt-dlp is installed. Version: ${ytdlpVer}`);
  ytdlpOk = true;
} catch (err) {
  console.error("[✘] yt-dlp check failed:", err.message);
}

// 2. Check ffmpeg
try {
  const ffmpegVer = execSync('ffmpeg -version').toString().split('\n')[0].trim();
  console.log(`[✔] ffmpeg is installed. Version: ${ffmpegVer}`);
  ffmpegOk = true;
} catch (err) {
  console.error("[✘] ffmpeg check failed:", err.message);
}

// 3. Check project files
const dbFile = path.join(__dirname, 'database.json');
const serverFile = path.join(__dirname, 'server.js');
const indexFile = path.join(__dirname, 'public', 'index.html');

console.log(`\nChecking project files:`);
console.log(`- database.json: ${fs.existsSync(dbFile) ? '[✔] Exists' : '[✘] Missing'}`);
console.log(`- server.js: ${fs.existsSync(serverFile) ? '[✔] Exists' : '[✘] Missing'}`);
console.log(`- public/index.html: ${fs.existsSync(indexFile) ? '[✔] Exists' : '[✘] Missing'}`);

// 4. Test database readability
try {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  console.log(`[✔] database.json is valid JSON. Found ${db.performers.length} performers and ${db.games.length} games.`);
} catch (err) {
  console.error("[✘] database.json parsing failed:", err.message);
}

if (ytdlpOk && ffmpegOk) {
  console.log("\n=== DIAGNOSTICS SUCCESSFUL. READY FOR LAUNCH ===");
} else {
  console.error("\n=== DIAGNOSTICS COMPLETED WITH ERRORS. FIX SYSTEM DEPENDENCIES ===");
}
