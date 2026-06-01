const fs = require('fs');
const path = require('path');

const cookiesPath = path.join(__dirname, 'cookies.txt');

function parseCookiesFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error("Cookies file not found:", filePath);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const cookies = [];

  for (const line of lines) {
    if (!line || line.startsWith('#') || line.trim() === '') {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length >= 7) {
      const domain = parts[0];
      const name = parts[5];
      const value = parts[6].trim();
      
      if (domain.includes('chaturbate.com')) {
        cookies.push(`${name}=${value}`);
      }
    }
  }
  return cookies.join('; ');
}

async function run() {
  console.log("Loading cookies...");
  const cookieHeader = parseCookiesFile(cookiesPath);
  
  const url = 'https://chaturbate.com/followed-cams/';
  console.log(`Fetching followed cams list from ${url}...`);

  try {
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Brave/1.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://chaturbate.com/',
        'Connection': 'keep-alive'
      }
    });

    if (!res.ok) {
      console.error(`HTTP Error: ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const html = await res.text();
    
    // Check if successfully logged in
    if (html.includes('lockmihai')) {
      console.log("[✔] Successfully authenticated as 'lockmihai'!");
    } else {
      console.log("[✘] Authentication check failed. The cookies may have expired or need refreshing.");
      // We can still try to parse because followed cams page redirects or shows nothing if not logged in.
    }

    // Regex to find usernames in room cards
    // Usually: <li class="roomCard ..."> ... <a href="/username/">
    // Let's search for roomCard pattern
    // Alternatively, let's find all hrefs in the format: href="/username/" and screen them.
    const hrefRegex = /href="\/([a-zA-Z0-9_-]+)\/"/g;
    const matches = new Set();
    let match;
    
    // System paths to exclude
    const excludeList = new Set([
      'privacy', 'terms', 'discover', 'tags', 'spy-on-cams', 'teen-cams', '18to21-cams', 
      '20to30-cams', '30to50-cams', 'mature-cams', 'north-american-cams', 'other-region-cams', 
      'euro-russian-cams', 'asian-cams', 'south-american-cams', 'new-cams', 'gaming-cams', 
      'female-cams', 'male-cams', 'couple-cams', 'trans-cams', 'security', 'law_enforcement', 
      'billingsupport', 'v2apps', 'affiliates', 'jobs', 'sitemap', '2257', 'followed-cams', 
      'auth', 'accounts', 'login', 'signup', 'contest', 'tags', 'tag'
    ]);

    while ((match = hrefRegex.exec(html)) !== null) {
      const username = match[1].toLowerCase();
      if (!excludeList.has(username) && username.length > 2) {
        matches.add(match[1]); // Keep original casing
      }
    }

    console.log("\n=== ONLINE FOLLOWED PERFORMERS ===");
    const activeModels = Array.from(matches);
    if (activeModels.length === 0) {
      console.log("No followed performers are currently live, or unable to read list.");
    } else {
      activeModels.forEach((name, idx) => {
        console.log(`${idx + 1}. @${name} (https://chaturbate.com/${name}/)`);
      });
    }
    console.log("==================================\n");

  } catch (err) {
    console.error("Error running script:", err.message);
  }
}

run();
