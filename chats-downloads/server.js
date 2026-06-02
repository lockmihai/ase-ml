const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const basicAuth = require('express-basic-auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Set up basic authentication for all routes
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(basicAuth({
    authorizer: (username, password) => {
        const userMatches = basicAuth.safeCompare(username, ADMIN_USERNAME);
        const passwordMatches = basicAuth.safeCompare(password, ADMIN_PASSWORD);
        return userMatches & passwordMatches;
    },
    challenge: true,
    realm: 'Antigravity Optimizer'
}));

app.use(express.static(path.join(__dirname, 'public')));
// Serve the downloads directory so the files can be played back in the browser
app.use('/video-downloads', express.static(path.join(__dirname, 'downloads')));

const DB_FILE = path.join(__dirname, 'database.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Active recording processes state
// Key: username, Value: { process, startTime, bytesDownloaded, speed, elapsed, logs: [] }
const activeRecordings = {};

// Helper: Read database
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { performers: [], games: [], recordings: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return { performers: [], games: [], recordings: [] };
  }
}

// Helper: Write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing database:", error);
  }
}

// Parse yt-dlp progress lines
// E.g.: [download]  10.23MiB at  1.12MiB/s (00:12)
function parseProgress(line) {
  const regex = /([\d.]+)\s*(?:MiB|KiB|GiB|B)\s+at\s+([\d.]+)(?:MiB\/s|KiB\/s|GiB\/s|B\/s)\s*\(([\d:]+)\)/i;
  const match = line.match(regex);
  if (match) {
    // If it contains "at", let's parse units
    let sizeStr = line.match(/download\]\s+([\d.]+)(?:MiB|KiB|GiB|B)/i);
    let size = sizeStr ? sizeStr[1] + " MiB" : match[1] + " MiB";
    if (line.includes('KiB')) size = sizeStr ? sizeStr[1] + " KiB" : match[1] + " KiB";
    if (line.includes('GiB')) size = sizeStr ? sizeStr[1] + " GiB" : match[1] + " GiB";
    
    return {
      size: size,
      speed: match[2] + " MiB/s",
      elapsed: match[3]
    };
  }
  
  // Alternative match for live streams which don't have ETA
  // E.g. [download] Destination: downloads/username.mp4
  // E.g. [download]   5.23MiB at  1.12MiB/s (00:05)
  const altRegex = /download\]\s+([\d.]+)\s*(\w+)\s+at\s+([\d.]+)\s*(\w+\/s)\s*\(([\d:]+)\)/i;
  const altMatch = line.match(altRegex);
  if (altMatch) {
    return {
      size: `${altMatch[1]} ${altMatch[2]}`,
      speed: `${altMatch[3]} ${altMatch[4]}`,
      elapsed: altMatch[5]
    };
  }

  return null;
}

// Route: Status check
app.get('/api/status', (req, res) => {
  let ytdlpInstalled = false;
  let ffmpegInstalled = false;
  let ytdlpVersion = "Unknown";
  let ffmpegVersion = "Unknown";

  try {
    const ytdlpVer = execSync('yt-dlp --version').toString().trim();
    ytdlpInstalled = true;
    ytdlpVersion = ytdlpVer;
  } catch (err) {}

  try {
    const ffmpegVer = execSync('ffmpeg -version').toString().split('\n')[0].trim();
    ffmpegInstalled = true;
    ffmpegVersion = ffmpegVer;
  } catch (err) {}

  // Calculate downloads folder size
  let totalFiles = 0;
  let totalSizeMB = 0;
  if (fs.existsSync(DOWNLOADS_DIR)) {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    files.forEach(file => {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        totalFiles++;
        totalSizeMB += stat.size / (1024 * 1024);
      }
    });
  }

  res.json({
    ytdlp: { installed: ytdlpInstalled, version: ytdlpVersion },
    ffmpeg: { installed: ffmpegInstalled, version: ffmpegVersion },
    downloads: {
      count: totalFiles,
      sizeMB: Math.round(totalSizeMB * 100) / 100
    },
    activeRecordingsCount: Object.keys(activeRecordings).length
  });
});

// Route: Get active recordings
app.get('/api/record/active', (req, res) => {
  const active = {};
  for (const [username, item] of Object.entries(activeRecordings)) {
    active[username] = {
      username: username,
      startTime: item.startTime,
      size: item.size || "0 B",
      speed: item.speed || "0 B/s",
      elapsed: item.elapsed || "00:00",
      logs: item.logs.slice(-5) // return last 5 log lines
    };
  }
  res.json(active);
});

// Route: Start recording
app.post('/api/record/start', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleanUsername) {
    return res.status(400).json({ error: "Invalid username format" });
  }

  if (activeRecordings[cleanUsername]) {
    return res.status(400).json({ error: `Already recording stream for ${cleanUsername}` });
  }

  // Construct yt-dlp arguments
  const outputPattern = path.join(DOWNLOADS_DIR, `${cleanUsername}_%Y%m%d_%H%M%S.mp4`);
  
  const args = [
    `https://chaturbate.com/${cleanUsername}/`,
    '-o', outputPattern,
    '--merge-output-format', 'mp4',
    '--no-part', // Write directly to target file without .part extension so we can play immediately
    '--hls-use-mpegts' // Use MPEG-TS for livestream fragments (resilient to interruptions)
  ];

  // Check if cookies.txt exists in the project folder to bypass Cloudflare login checks
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  } else if (process.env.username && process.env.password) {
    // Read credentials
    args.push('--username', process.env.username);
    args.push('--password', process.env.password);
  }

  console.log(`Spawning yt-dlp with arguments:`, args.map(a => a.includes('Parola') ? '****' : a));

  const child = spawn('yt-dlp', args);
  let hasSentResponse = false;
  let startupError = "";

  activeRecordings[cleanUsername] = {
    process: child,
    startTime: new Date().toISOString(),
    size: "0 B",
    speed: "Searching...",
    elapsed: "00:00",
    logs: []
  };

  child.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[yt-dlp stdout ${cleanUsername}]: ${text.trim()}`);
    
    const record = activeRecordings[cleanUsername];
    if (record) {
      record.logs.push(text);
      if (record.logs.length > 50) record.logs.shift(); // Cap logs

      // Parse progress data
      const progress = parseProgress(text);
      if (progress) {
        record.size = progress.size;
        record.speed = progress.speed;
        record.elapsed = progress.elapsed;
      }
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`[yt-dlp stderr ${cleanUsername}]: ${text.trim()}`);
    startupError += text;
    
    const record = activeRecordings[cleanUsername];
    if (record) {
      record.logs.push(`ERROR: ${text}`);
      if (record.logs.length > 50) record.logs.shift();
    }
  });

  child.on('close', (code) => {
    console.log(`yt-dlp process for ${cleanUsername} exited with code ${code}`);
    
    // Log the end of recording in the database
    const record = activeRecordings[cleanUsername];
    if (record) {
      const db = readDB();
      db.recordings.push({
        username: cleanUsername,
        startTime: record.startTime,
        endTime: new Date().toISOString(),
        finalSize: record.size || "Unknown",
        duration: record.elapsed || "Unknown",
        exitCode: code
      });
      writeDB(db);
    }

    delete activeRecordings[cleanUsername];

    // If it exited immediately before we could respond, return error
    if (!hasSentResponse) {
      hasSentResponse = true;
      let friendlyError = "Stream recording failed.";
      if (startupError.includes("offline")) {
        friendlyError = "Performer is currently offline.";
      } else if (startupError.includes("404")) {
        friendlyError = "Performer profile not found (404). Check spelling.";
      } else if (startupError.includes("impersonation")) {
        // Not a fatal error, just a warning in most cases, but if it exited 1:
        friendlyError = "Failed to access stream. Performer might be offline or age-restricted.";
      }
      res.status(500).json({ error: friendlyError, details: startupError.trim() });
    }
  });

  // Wait 3.5 seconds to confirm that yt-dlp connects and is actually downloading (doesn't crash immediately)
  setTimeout(() => {
    if (!hasSentResponse) {
      hasSentResponse = true;
      res.json({
        success: true,
        message: `Recording started for ${cleanUsername}. Connection successful.`,
        startTime: activeRecordings[cleanUsername].startTime
      });
    }
  }, 3500);
});

// Route: Stop recording
app.post('/api/record/stop', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const cleanUsername = username.trim().toLowerCase();
  const record = activeRecordings[cleanUsername];
  if (!record) {
    return res.status(404).json({ error: `No active recording found for ${cleanUsername}` });
  }

  console.log(`Stopping recording for ${cleanUsername} (PID: ${record.process.pid})`);
  
  // Standard way is SIGINT, so ffmpeg/yt-dlp can gracefully flush and write the MP4 container header
  record.process.kill('SIGINT');

  res.json({ success: true, message: `Stop signal sent to recording process for ${cleanUsername}.` });
});

// Route: List all downloads
app.get('/api/recordings', (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(DOWNLOADS_DIR);
    const recordings = files
      .filter(file => file.endsWith('.mp4') || file.endsWith('.ts') || file.endsWith('.mkv'))
      .map(file => {
        const filePath = path.join(DOWNLOADS_DIR, file);
        const stat = fs.statSync(filePath);
        
        // Extract username from filename (e.g. username_20260531_062205.mp4)
        const parts = file.split('_');
        const username = parts[0];

        return {
          filename: file,
          username: username,
          sizeMB: Math.round((stat.size / (1024 * 1024)) * 100) / 100,
          createdAt: stat.birthtime.toISOString(),
          path: `/video-downloads/${file}`
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Newest first

    res.json(recordings);
  } catch (error) {
    res.status(500).json({ error: "Error reading recordings directory", details: error.message });
  }
});

// Route: Delete recording file
app.delete('/api/recordings/:filename', (req, res) => {
  const filename = req.params.filename;
  // Prevent directory traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(DOWNLOADS_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Successfully deleted ${safeFilename}` });
  } catch (error) {
    res.status(500).json({ error: "Could not delete file", details: error.message });
  }
});

// ==========================================
// PERFORMER CRM ENDPOINTS
// ==========================================

// GET all performers
app.get('/api/performers', (req, res) => {
  const db = readDB();
  res.json(db.performers || []);
});

// POST create performer
app.post('/api/performers', (req, res) => {
  const { id, name, baseline_tips, target_tips, cut_percent, notes } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "ID and Display Name are required" });
  }

  const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const db = readDB();

  if (db.performers.find(p => p.id === cleanId)) {
    return res.status(400).json({ error: `Performer with ID '${cleanId}' already exists.` });
  }

  const newPerformer = {
    id: cleanId,
    name: name.trim(),
    baseline_tips: Number(baseline_tips) || 0,
    target_tips: Number(target_tips) || 0,
    cut_percent: Number(cut_percent) || 10,
    notes: (notes || "").trim(),
    sessions: []
  };

  db.performers.push(newPerformer);
  writeDB(db);
  res.status(201).json(newPerformer);
});

// PUT update performer
app.put('/api/performers/:id', (req, res) => {
  const performerId = req.params.id;
  const { name, baseline_tips, target_tips, cut_percent, notes } = req.body;

  const db = readDB();
  const index = db.performers.findIndex(p => p.id === performerId);
  
  if (index === -1) {
    return res.status(404).json({ error: "Performer not found" });
  }

  const performer = db.performers[index];
  if (name) performer.name = name.trim();
  if (baseline_tips !== undefined) performer.baseline_tips = Number(baseline_tips) || 0;
  if (target_tips !== undefined) performer.target_tips = Number(target_tips) || 0;
  if (cut_percent !== undefined) performer.cut_percent = Number(cut_percent) || 0;
  if (notes !== undefined) performer.notes = notes.trim();

  db.performers[index] = performer;
  writeDB(db);
  res.json(performer);
});

// DELETE performer
app.delete('/api/performers/:id', (req, res) => {
  const performerId = req.params.id;
  const db = readDB();
  const filtered = db.performers.filter(p => p.id !== performerId);
  
  if (db.performers.length === filtered.length) {
    return res.status(404).json({ error: "Performer not found" });
  }

  db.performers = filtered;
  writeDB(db);
  res.json({ success: true, message: `Deleted performer ${performerId}` });
});

// POST add session to performer (calculates commissions)
app.post('/api/performers/:id/sessions', (req, res) => {
  const performerId = req.params.id;
  const { date, duration_hours, total_tips, notes } = req.body;

  if (!date || !duration_hours || !total_tips) {
    return res.status(400).json({ error: "Date, duration, and total tips are required" });
  }

  const db = readDB();
  const performer = db.performers.find(p => p.id === performerId);
  if (!performer) {
    return res.status(404).json({ error: "Performer not found" });
  }

  const newSession = {
    id: 'sess_' + Date.now(),
    date: date,
    duration_hours: Number(duration_hours),
    total_tips: Number(total_tips),
    notes: (notes || "").trim(),
    commission_paid: false
  };

  performer.sessions.push(newSession);
  writeDB(db);
  res.status(201).json({ performer, session: newSession });
});

// PUT toggle session payment status
app.put('/api/performers/:performerId/sessions/:sessionId/toggle-payment', (req, res) => {
  const { performerId, sessionId } = req.params;
  const db = readDB();
  const performer = db.performers.find(p => p.id === performerId);
  if (!performer) {
    return res.status(404).json({ error: "Performer not found" });
  }

  const session = performer.sessions.find(s => s.id === sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  session.commission_paid = !session.commission_paid;
  writeDB(db);
  res.json({ performer, session });
});

// DELETE session
app.delete('/api/performers/:performerId/sessions/:sessionId', (req, res) => {
  const { performerId, sessionId } = req.params;
  const db = readDB();
  const performer = db.performers.find(p => p.id === performerId);
  if (!performer) {
    return res.status(404).json({ error: "Performer not found" });
  }

  performer.sessions = performer.sessions.filter(s => s.id !== sessionId);
  writeDB(db);
  res.json({ success: true, performer });
});

// ==========================================
// TIP GAMES ENDPOINTS
// ==========================================

app.get('/api/games', (req, res) => {
  const db = readDB();
  res.json(db.games || []);
});

app.post('/api/games', (req, res) => {
  const { title, description, menu } = req.body;
  if (!title || !menu || !Array.isArray(menu)) {
    return res.status(400).json({ error: "Title and Menu array are required" });
  }

  const db = readDB();
  const newGame = {
    id: 'game_' + Date.now(),
    title: title.trim(),
    description: (description || "").trim(),
    menu: menu.map(m => ({ tokens: Number(m.tokens) || 0, action: String(m.action).trim() }))
  };

  db.games.push(newGame);
  writeDB(db);
  res.status(201).json(newGame);
});

app.delete('/api/games/:id', (req, res) => {
  const gameId = req.params.id;
  const db = readDB();
  const filtered = db.games.filter(g => g.id !== gameId);

  if (db.games.length === filtered.length) {
    return res.status(404).json({ error: "Game preset not found" });
  }

  db.games = filtered;
  writeDB(db);
  res.json({ success: true, message: `Deleted game preset ${gameId}` });
});

// ==========================================
// SUGGESTIONS ENGINE (LOCAL RULE ENGINE)
// ==========================================

app.post('/api/suggestions', (req, res) => {
  const { category, style, schedule, experience } = req.body;

  if (!category || !style) {
    return res.status(400).json({ error: "Category and Style fields are required." });
  }

  // A powerful and sophisticated rules engine that generates dynamic, beautiful suggestions
  const suggestions = {
    generalTips: [
      "**Interactive Menu**: Keep a clean, updated interactive tip menu visible in your bio and stream overlay. Use specific, easily actionable items rather than generic goals.",
      "**Stream Schedule consistency**: Having a set calendar increases return rates by over 40%. Alert users in your bio of your exact schedule.",
      "**Goal setting**: Split large goals (e.g. 2000 tokens for outfit change) into smaller milestone tiers (e.g. 500 tokens = shoe change, 1000 tokens = wig change, etc.) to keep users motivated."
    ],
    nicheSuggestions: [],
    marketingStrategy: [],
    gameRecommendations: []
  };

  // Add specific category strategies
  if (category.toLowerCase() === 'female') {
    suggestions.nicheSuggestions.push(
      "**High-margin Tip Tiers**: Use high-value milestones (200+ tokens) for customized activities or roleplay scenarios.",
      "**Interactive Lovense/Toy Integration**: Connect smart toys to tips. Set up distinct levels: e.g. 5 tokens (low), 25 tokens (medium), 100 tokens (high/custom wave)."
    );
    suggestions.gameRecommendations.push(
      "**Spin the Wheel (Medium Tier)**: Set up a wheel with 8 slots. Price spins at 50-100 tokens. Actions can include outfit accessories, choosing background lighting color, or doing custom emotes.",
      "**Mystery Box (Premium Tier)**: Price at 200 tokens. Broadcaster picks a card or opens a box with a surprise prize/interaction inside."
    );
  } else if (category.toLowerCase() === 'gaming') {
    suggestions.nicheSuggestions.push(
      "**Game Overlays & Stream Widgets**: Display tip goals directly on your game UI without blocking essential gameplay.",
      "**Play with Viewers**: Let viewers tip to join your lobby (e.g., 200 tokens to join a 15-minute match) or tip to control your in-game setup (e.g., 50 tokens to force you to drop a weapon or play blindfolded for 1 minute)."
    );
    suggestions.gameRecommendations.push(
      "**Dare Matrix**: Viewers tip 30 tokens to choose a gaming dare (e.g., 'no reloading for 1 round', 'play with one hand for 1 minute').",
      "**Drunk / Challenge Mode**: Cumulative tip goals that unlock challenges (e.g., '1000 tokens = hard mode speedrun session')."
    );
  } else if (category.toLowerCase() === 'couple') {
    suggestions.nicheSuggestions.push(
      "**Cooperative Goals**: Create split-goal thermometers (e.g., Target: 3000 tokens. Person A goals vs Person B goals). Keep the competitive spirit going between fans.",
      "**Interactive Storyboards**: Let viewers tip to vote on the next segment of the stream (e.g., 'Tip 50 tokens to choose Option A or B')."
    );
    suggestions.gameRecommendations.push(
      "**Truth or Dare Dice**: Tip 50 tokens to roll the Truth/Dare dice for either partner.",
      "**Blindfolded Coordination**: Set up a milestone where one partner is blindfolded and guided by the other, driven by viewer tip goals."
    );
  } else {
    // default/other
    suggestions.nicheSuggestions.push(
      "**Chat Gamification**: Reward active chat participation but lock direct interactions behind tip goals.",
      "**Lighting & Atmosphere Control**: Set up a smart lighting rig. Let viewers tip 10-25 tokens to change the color/mood of your room."
    );
    suggestions.gameRecommendations.push(
      "**Song Request**: Tip 30 tokens to queue a song, or 100 tokens to bump a song to the top of the playlist.",
      "**Dice Roll Game**: 20 tokens to roll. Low stakes, highly repeatable."
    );
  }

  // Add style suggestions
  if (style.toLowerCase().includes('talkative') || style.toLowerCase().includes('chatty')) {
    suggestions.generalTips.push(
      "**Conversation Boosters**: Keep a list of prompt questions or 'Tip to ask anything' tiers. When a viewer tips 25 tokens, read their question with top priority."
    );
    suggestions.marketingStrategy.push(
      "**Fan-Club Q&A**: Offer exclusive voice or written Q&A sessions for fan-club subscribers.",
      "**Weekly Newsletter / Blog**: Share insights or schedules with fans via direct message blasts."
    );
  } else if (style.toLowerCase().includes('shy') || style.toLowerCase().includes('chill')) {
    suggestions.generalTips.push(
      "**Subtle Interactions**: Focus on music, aesthetic lighting, and text-to-speech tip integrations. Allow users to interact without requiring intense vocal presence.",
      "**Lofi / ASMR elements**: Set up soft microphone gains and ASMR tip goals (e.g., 50 tokens for 2 minutes of whispering)."
    );
    suggestions.marketingStrategy.push(
      "**Curated Playlists**: Share Spotify playlists with your fan base on social media to build a cozy, shared community vibe."
    );
  } else {
    // energetic/wild
    suggestions.generalTips.push(
      "**Flash Goals**: Run short 10-minute sprint goals (e.g., 'If we reach 500 tokens in the next 10 minutes, I'll do a special cheer!'). This drives impulse tipping."
    );
    suggestions.marketingStrategy.push(
      "**Teaser Clips on Socials**: Post short, high-energy clips on Twitter/X or TikTok to drive traffic to the next stream."
    );
  }

  // Experience level adjustments
  if (experience === 'beginner') {
    suggestions.marketingStrategy.push(
      "**Promote Free Bio Info**: Ensure your links, rules, and schedules are pinned. Do not charge for basic chat access.",
      "**Create standard tip tiers**: Start with a basic menu of 5 elements before creating complex dice/spin games."
    );
  } else {
    suggestions.marketingStrategy.push(
      "**Premium Fan Club Tier**: Create custom content drops for VIP fan club members.",
      "**Cross-Promote Content**: Direct fans to your OnlyFans, Fansly, or premium clip stores during natural breaks in the livestream."
    );
  }

  res.json({
    category,
    style,
    suggestions: suggestions
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Downloads folder: ${DOWNLOADS_DIR}`);
  console.log(`Database file: ${DB_FILE}`);
});
