// Global State
let performers = [];
let gamePresets = [];
let activeRecordings = {};

// On Page Load
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // Load Initial Data
  initApp();

  // Setup Event Listeners
  setupEventListeners();

  // Periodic Status Polls
  setInterval(pollSystemStatus, 4000);
});

// Initialize App
async function initApp() {
  await pollSystemStatus();
  await loadPerformers();
  await loadGamePresets();
  await loadRecordingsList();
}

// ==========================================
// API CLIENT CALLS & STATUS POLLS
// ==========================================

async function pollSystemStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    
    // Update Header Status indicators
    updateStatusBadge("ytdlp-status", data.ytdlp.installed, `yt-dlp: v${data.ytdlp.version}`);
    updateStatusBadge("ffmpeg-status", data.ffmpeg.installed, `ffmpeg: online`);
    
    const storageLabel = document.querySelector("#storage-status .status-label");
    if (storageLabel) {
      storageLabel.textContent = `${data.downloads.count} files (${data.downloads.sizeMB} MB)`;
    }

    // Refresh Active Recordings Badge
    const activeBadge = document.getElementById("active-recordings-badge");
    if (activeBadge) {
      if (data.activeRecordingsCount > 0) {
        activeBadge.textContent = data.activeRecordingsCount;
        activeBadge.style.display = "inline-block";
      } else {
        activeBadge.style.display = "none";
      }
    }

    // If on recorder tab, poll active records details
    const activeTab = document.querySelector(".nav-item.active").getAttribute("data-tab");
    if (activeTab === "recorder") {
      await refreshActiveRecordings();
    }
  } catch (err) {
    console.error("Error polling system status:", err);
  }
}

function updateStatusBadge(id, installed, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const dot = el.querySelector(".dot");
  const label = el.querySelector(".status-label");

  if (installed) {
    dot.className = "dot green";
    label.textContent = text;
  } else {
    dot.className = "dot red";
    label.textContent = `${id.split('-')[0]}: missing`;
  }
}

// Load Performers
async function loadPerformers() {
  try {
    const res = await fetch("/api/performers");
    performers = await res.json();
    renderPerformersGrid();
  } catch (err) {
    console.error("Error loading performers:", err);
  }
}

// Load Game Presets
async function loadGamePresets() {
  try {
    const res = await fetch("/api/games");
    gamePresets = await res.json();
    
    // Populate Select Dropdown
    const select = document.getElementById("game-preset-select");
    if (select) {
      // Clear previous options
      select.innerHTML = '<option value="">-- Start from Scratch --</option>';
      gamePresets.forEach(preset => {
        const opt = document.createElement("option");
        opt.value = preset.id;
        opt.textContent = preset.title;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error loading game presets:", err);
  }
}

// Load Recordings Directory
async function loadRecordingsList() {
  try {
    const res = await fetch("/api/recordings");
    const recordings = await res.json();
    renderDownloadsTable(recordings);
  } catch (err) {
    console.error("Error loading recordings:", err);
  }
}

// Refresh Active Recording Logs & Progress
async function refreshActiveRecordings() {
  try {
    const res = await fetch("/api/record/active");
    activeRecordings = await res.json();
    
    const container = document.getElementById("active-recording-states");
    if (!container) return;

    if (Object.keys(activeRecordings).length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted pad-md" style="padding: 2rem 0;">
          <i data-lucide="video-off" style="margin-bottom: 0.5rem; opacity: 0.4;"></i>
          <p style="font-size: 0.85rem;">No active stream recordings running.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    let html = "";
    for (const [username, item] of Object.entries(activeRecordings)) {
      html += `
        <div class="recording-card" data-username="${username}">
          <div class="recording-header">
            <div class="recording-title">
              <span class="live-pulse-dot"></span>
              Recording: @${username}
            </div>
            <button class="btn btn-danger btn-sm btn-icon-text btn-stop-recording" data-username="${username}">
              <i data-lucide="square"></i> Stop
            </button>
          </div>
          <div class="recording-stats">
            <div class="stat-item">
              <span>Size Downloaded</span>
              <span>${item.size}</span>
            </div>
            <div class="stat-item">
              <span>Download Speed</span>
              <span>${item.speed}</span>
            </div>
            <div class="stat-item">
              <span>Time Elapsed</span>
              <span>${item.elapsed}</span>
            </div>
          </div>
          <div class="recording-logs" id="log-box-${username}">${item.logs.join('') || 'Initializing connection...'}</div>
        </div>
      `;
    }
    
    container.innerHTML = html;
    lucide.createIcons();

    // Auto scroll active log windows to bottom
    for (const username of Object.keys(activeRecordings)) {
      const box = document.getElementById(`log-box-${username}`);
      if (box) box.scrollTop = box.scrollHeight;
    }

    // Attach Stop Button Event Listeners
    container.querySelectorAll(".btn-stop-recording").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const user = btn.getAttribute("data-username");
        btn.disabled = true;
        btn.textContent = "Stopping...";
        await stopStreamRecording(user);
        await pollSystemStatus();
        await loadRecordingsList();
      });
    });

  } catch (err) {
    console.error("Error refreshing active recordings:", err);
  }
}

// Stop Recording API
async function stopStreamRecording(username) {
  try {
    const res = await fetch("/api/record/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const result = await res.json();
    if (result.error) {
      alert(result.error);
    } else {
      console.log(result.message);
    }
  } catch (err) {
    alert("Connection error occurred stopping recording.");
  }
}

// ==========================================
// EVENT LISTENERS SETUP
// ==========================================

function setupEventListeners() {
  // 1. Tab Switching
  const navItems = document.querySelectorAll(".nav-item");
  const tabContents = document.querySelectorAll(".tab-content");
  
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const tab = item.getAttribute("data-tab");
      
      navItems.forEach(i => i.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      
      item.classList.add("active");
      document.getElementById(`panel-${tab}`).classList.add("active");
      
      // Refresh context data when tabs are swapped
      if (tab === "recorder") {
        loadRecordingsList();
        refreshActiveRecordings();
      } else if (tab === "performers") {
        loadPerformers();
      } else if (tab === "games") {
        loadGamePresets();
      }
    });
  });

  // 2. Start Recording Form
  const recordForm = document.getElementById("record-start-form");
  if (recordForm) {
    recordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("record-username");
      const username = input.value.trim();
      if (!username) return;

      const submitBtn = document.getElementById("btn-start-record");
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="dot yellow"></span> Connecting...';

      try {
        const res = await fetch("/api/record/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (data.error) {
          alert(`Recording Error: ${data.error}`);
        } else {
          input.value = "";
          await refreshActiveRecordings();
        }
      } catch (err) {
        alert("Failed to connect to the recorder backend.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }

  // 3. Refresh Downloads Button
  const refreshDlBtn = document.getElementById("btn-refresh-downloads");
  if (refreshDlBtn) {
    refreshDlBtn.addEventListener("click", () => {
      loadRecordingsList();
    });
  }

  // 4. Modal Triggers & Cancellations
  setupModals();

  // 5. Game Row Creator logic
  const addRowBtn = document.getElementById("btn-add-game-row");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      addGameOptionRow(0, "");
    });
  }

  // Game Preset selection change
  const presetSelect = document.getElementById("game-preset-select");
  if (presetSelect) {
    presetSelect.addEventListener("change", () => {
      const presetId = presetSelect.value;
      const form = document.getElementById("game-editor-form");
      const container = document.getElementById("game-options-container");
      container.innerHTML = ""; // Clear active rows

      if (presetId) {
        const preset = gamePresets.find(g => g.id === presetId);
        if (preset) {
          document.getElementById("game-title").value = preset.title;
          document.getElementById("game-description").value = preset.description;
          preset.menu.forEach(item => {
            addGameOptionRow(item.tokens, item.action);
          });
        }
      } else {
        form.reset();
        addGameOptionRow(20, "Blow a kiss"); // default empty placeholder
      }
    });
  }

  // Submit Game form
  const gameForm = document.getElementById("game-editor-form");
  if (gameForm) {
    gameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      generateGameOutput();
    });
  }

  // Copy Game text
  const copyGameBtn = document.getElementById("btn-copy-game-text");
  if (copyGameBtn) {
    copyGameBtn.addEventListener("click", () => {
      const textOutput = document.getElementById("game-text-output");
      textOutput.select();
      document.execCommand("copy");
      
      const originalText = copyGameBtn.innerHTML;
      copyGameBtn.innerHTML = '<i data-lucide="check"></i> Copied!';
      lucide.createIcons();
      setTimeout(() => {
        copyGameBtn.innerHTML = originalText;
        lucide.createIcons();
      }, 1500);
    });
  }

  // 6. Suggestions form submit
  const suggestionsForm = document.getElementById("suggestions-generator-form");
  if (suggestionsForm) {
    suggestionsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await generateSuggestions();
    });
  }
}

// Modal handling logic
function setupModals() {
  // Add Performer Modal
  const addPerfBtn = document.getElementById("btn-add-performer-modal");
  const perfModal = document.getElementById("performer-modal");
  const closePerfBtn = document.getElementById("btn-close-performer-modal");
  const cancelPerfBtn = document.getElementById("btn-cancel-performer");
  const perfForm = document.getElementById("performer-form");

  if (addPerfBtn && perfModal) {
    addPerfBtn.addEventListener("click", () => perfModal.classList.add("active"));
  }
  
  const closePerfModal = () => {
    perfModal.classList.remove("active");
    perfForm.reset();
  };

  if (closePerfBtn) closePerfBtn.addEventListener("click", closePerfModal);
  if (cancelPerfBtn) cancelPerfBtn.addEventListener("click", closePerfModal);

  if (perfForm) {
    perfForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("perf-id").value;
      const name = document.getElementById("perf-name").value;
      const baseline = document.getElementById("perf-baseline").value;
      const target = document.getElementById("perf-target").value;
      const cut = document.getElementById("perf-cut").value;
      const notes = document.getElementById("perf-notes").value;

      try {
        const res = await fetch("/api/performers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name, baseline_tips: baseline, target_tips: target, cut_percent: cut, notes })
        });
        const data = await res.json();
        
        if (data.error) {
          alert(data.error);
        } else {
          closePerfModal();
          await loadPerformers();
        }
      } catch (err) {
        alert("Error creating performer client.");
      }
    });
  }

  // Log Session Modal
  const sessionModal = document.getElementById("session-modal");
  const closeSessBtn = document.getElementById("btn-close-session-modal");
  const cancelSessBtn = document.getElementById("btn-cancel-session");
  const sessionForm = document.getElementById("session-form");

  const closeSessModal = () => {
    sessionModal.classList.remove("active");
    sessionForm.reset();
  };

  if (closeSessBtn) closeSessBtn.addEventListener("click", closeSessModal);
  if (cancelSessBtn) cancelSessBtn.addEventListener("click", closeSessModal);

  if (sessionForm) {
    sessionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("session-perf-id").value;
      const date = document.getElementById("sess-date").value;
      const duration = document.getElementById("sess-duration").value;
      const tips = document.getElementById("sess-tips").value;
      const notes = document.getElementById("sess-notes").value;

      try {
        const res = await fetch(`/api/performers/${id}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, duration_hours: duration, total_tips: tips, notes })
        });
        const data = await res.json();

        if (data.error) {
          alert(data.error);
        } else {
          closeSessModal();
          await loadPerformers();
        }
      } catch (err) {
        alert("Error logging session.");
      }
    });
  }

  // Video Playback Modal
  const videoModal = document.getElementById("video-modal");
  const closeVideoBtn = document.getElementById("btn-close-video-modal");
  const player = document.getElementById("archive-video-player");

  if (closeVideoBtn && videoModal) {
    closeVideoBtn.addEventListener("click", () => {
      videoModal.classList.remove("active");
      player.pause();
      player.querySelector("source").src = "";
      player.load();
    });
  }
}

// ==========================================
// RENDERERS
// ==========================================

// Render Downloads Table
function renderDownloadsTable(recordings) {
  const tbody = document.getElementById("downloads-list");
  if (!tbody) return;

  if (recordings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted">No completed recordings found in downloads directory.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = recordings.map(rec => `
    <tr>
      <td><strong>@${rec.username}</strong></td>
      <td class="text-muted" style="font-family: var(--font-mono); font-size: 0.8rem;">${rec.filename}</td>
      <td>${rec.sizeMB} MB</td>
      <td>${new Date(rec.createdAt).toLocaleString()}</td>
      <td class="actions-col">
        <button class="btn-action play btn-play-video" data-src="${rec.path}" data-title="@${rec.username} - Archived Stream" title="Play Video">
          <i data-lucide="play-circle"></i>
        </button>
        <button class="btn-action delete btn-delete-video" data-filename="${rec.filename}" title="Delete File">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    </tr>
  `).join('');

  lucide.createIcons();

  // Attach Play button logic
  tbody.querySelectorAll(".btn-play-video").forEach(btn => {
    btn.addEventListener("click", () => {
      const src = btn.getAttribute("data-src");
      const title = btn.getAttribute("data-title");
      playVideo(src, title);
    });
  });

  // Attach Delete button logic
  tbody.querySelectorAll(".btn-delete-video").forEach(btn => {
    btn.addEventListener("click", async () => {
      const filename = btn.getAttribute("data-filename");
      if (confirm(`Are you sure you want to delete ${filename}? This cannot be undone.`)) {
        try {
          const res = await fetch(`/api/recordings/${encodeURIComponent(filename)}`, {
            method: "DELETE"
          });
          const resData = await res.json();
          if (resData.success) {
            await loadRecordingsList();
            await pollSystemStatus();
          } else {
            alert(resData.error);
          }
        } catch (err) {
          alert("Error deleting file.");
        }
      }
    });
  });
}

function playVideo(src, title) {
  const modal = document.getElementById("video-modal");
  const player = document.getElementById("archive-video-player");
  const modalTitle = document.getElementById("video-modal-title");

  if (!modal || !player) return;

  modalTitle.textContent = title;
  player.querySelector("source").src = src;
  player.load();
  modal.classList.add("active");
}

// Render Performers CRM Grid
function renderPerformersGrid() {
  const container = document.getElementById("performers-list-grid");
  if (!container) return;

  if (performers.length === 0) {
    container.innerHTML = `
      <div class="card glass text-center text-muted" style="grid-column: 1 / -1; padding: 3rem;">
        <i data-lucide="users-round" size="48" style="opacity: 0.3; margin-bottom: 1rem;"></i>
        <h3>No Performer Clients Added</h3>
        <p class="text-muted margin-top-sm">Add your performer clients to start tracking their tip increases and calculating your 10% commission cut.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = performers.map(perf => {
    // Math computations for commission
    let totalTips = 0;
    let totalBaselineExpected = 0;
    let totalIncrease = 0;
    let totalCommission = 0;
    let commissionPaid = 0;

    perf.sessions.forEach(sess => {
      totalTips += sess.total_tips;
      const baselineForSess = perf.baseline_tips * sess.duration_hours;
      totalBaselineExpected += baselineForSess;
      
      const increase = sess.total_tips - baselineForSess;
      if (increase > 0) {
        totalIncrease += increase;
        const comm = increase * (perf.cut_percent / 100);
        totalCommission += comm;
        if (sess.commission_paid) {
          commissionPaid += comm;
        }
      }
    });

    const commissionUnpaid = totalCommission - commissionPaid;

    // Render individual session rows
    const sessionRowsHTML = perf.sessions.length === 0 
      ? `<div class="text-center text-muted" style="padding: 1rem; font-size: 0.75rem;">No sessions logged yet.</div>`
      : perf.sessions.map(sess => {
          const baselineForSess = perf.baseline_tips * sess.duration_hours;
          const increase = sess.total_tips - baselineForSess;
          const commission = increase > 0 ? increase * (perf.cut_percent / 100) : 0;

          return `
            <div class="session-row">
              <div class="session-details">
                <strong>${sess.date}</strong>
                <span class="text-muted">${sess.duration_hours}h • ${sess.total_tips} tk (base expected: ${Math.round(baselineForSess)})</span>
              </div>
              <div class="session-earnings">
                <span class="session-commission">${commission > 0 ? `+${Math.round(commission)} tk` : '0 tk'}</span>
                <span class="commission-badge ${sess.commission_paid ? 'paid' : 'unpaid'}" 
                      data-performer-id="${perf.id}" 
                      data-session-id="${sess.id}"
                      title="Click to toggle paid status">
                  ${sess.commission_paid ? 'Paid' : 'Unpaid'}
                </span>
                <button class="btn-action delete btn-delete-session" 
                        data-performer-id="${perf.id}" 
                        data-session-id="${sess.id}"
                        style="padding: 0.1rem;"
                        title="Delete Session">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');

    return `
      <div class="performer-card glass" data-id="${perf.id}">
        <div class="performer-card-header">
          <div class="performer-info">
            <h3>${perf.name}</h3>
            <p>@${perf.id}</p>
          </div>
          <button class="btn-action delete btn-delete-performer" data-id="${perf.id}" title="Remove Client">
            <i data-lucide="user-x"></i>
          </button>
        </div>
        
        <p class="text-muted" style="font-size: 0.8rem; line-height: 1.4;">${perf.notes || 'No custom observations logged.'}</p>
        
        <div class="performer-stats-row">
          <div class="stat">
            <span class="stat-label">Total Tips</span>
            <span class="stat-val">${totalTips} tk</span>
          </div>
          <div class="stat">
            <span class="stat-label">Tips Increase</span>
            <span class="stat-val highlight">${Math.round(totalIncrease)} tk</span>
          </div>
          <div class="stat">
            <span class="stat-label">Outstanding Cut (${perf.cut_percent}%)</span>
            <span class="stat-val" style="color: var(--color-warning);">${Math.round(commissionUnpaid)} tk</span>
          </div>
        </div>

        <div class="sessions-section">
          <h4>Logged Stream Sessions</h4>
          <div class="session-list">
            ${sessionRowsHTML}
          </div>
        </div>

        <div class="performer-actions">
          <button class="btn btn-secondary btn-sm btn-icon-text btn-log-session-trigger" data-id="${perf.id}" data-name="${perf.name}">
            <i data-lucide="plus"></i> Log Stream Session
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();

  // Attach session log modal triggers
  container.querySelectorAll(".btn-log-session-trigger").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const name = btn.getAttribute("data-name");
      
      document.getElementById("session-perf-id").value = id;
      document.getElementById("session-perf-name").textContent = name;
      
      // Default to today's date
      document.getElementById("sess-date").value = new Date().toISOString().split('T')[0];

      document.getElementById("session-modal").classList.add("active");
    });
  });

  // Attach delete performer logic
  container.querySelectorAll(".btn-delete-performer").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (confirm(`Remove performer client @${id} and all their session history?`)) {
        try {
          const res = await fetch(`/api/performers/${id}`, { method: "DELETE" });
          const resData = await res.json();
          if (resData.success) {
            await loadPerformers();
          } else {
            alert(resData.error);
          }
        } catch (err) {
          alert("Error deleting client.");
        }
      }
    });
  });

  // Attach Toggle payment status logic
  container.querySelectorAll(".commission-badge").forEach(badge => {
    badge.addEventListener("click", async () => {
      const perfId = badge.getAttribute("data-performer-id");
      const sessId = badge.getAttribute("data-session-id");
      
      try {
        const res = await fetch(`/api/performers/${perfId}/sessions/${sessId}/toggle-payment`, {
          method: "PUT"
        });
        const resData = await res.json();
        if (resData.error) {
          alert(resData.error);
        } else {
          await loadPerformers();
        }
      } catch (err) {
        alert("Error toggling payment status.");
      }
    });
  });

  // Attach delete session logic
  container.querySelectorAll(".btn-delete-session").forEach(btn => {
    btn.addEventListener("click", async () => {
      const perfId = btn.getAttribute("data-performer-id");
      const sessId = btn.getAttribute("data-session-id");
      
      if (confirm("Delete this session entry?")) {
        try {
          const res = await fetch(`/api/performers/${perfId}/sessions/${sessId}`, {
            method: "DELETE"
          });
          const resData = await res.json();
          if (resData.success) {
            await loadPerformers();
          } else {
            alert(resData.error);
          }
        } catch (err) {
          alert("Error deleting session.");
        }
      }
    });
  });
}

// ==========================================
// GAME OPTION ROW GENERATOR & HTML RENDERER
// ==========================================

function addGameOptionRow(tokens, action) {
  const container = document.getElementById("game-options-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "option-row";
  row.innerHTML = `
    <input type="number" placeholder="Tokens" value="${tokens || ''}" required class="form-control">
    <input type="text" placeholder="Action reward" value="${action || ''}" required class="form-control">
    <button type="button" class="btn btn-action delete btn-delete-option-row"><i data-lucide="minus"></i></button>
  `;
  container.appendChild(row);
  lucide.createIcons();

  // Attach delete row logic
  row.querySelector(".btn-delete-option-row").addEventListener("click", () => {
    row.remove();
  });
}

function generateGameOutput() {
  const title = document.getElementById("game-title").value;
  const description = document.getElementById("game-description").value;
  const optionRows = document.querySelectorAll("#game-options-container .option-row");
  
  const menu = [];
  optionRows.forEach(row => {
    const inputs = row.querySelectorAll("input");
    const tokens = parseInt(inputs[0].value) || 0;
    const action = inputs[1].value.trim();
    if (action) {
      menu.push({ tokens, action });
    }
  });

  if (menu.length === 0) {
    alert("Please add at least one reward option!");
    return;
  }

  // 1. RENDER HTML PREVIEW
  const previewDiv = document.getElementById("game-html-preview");
  let previewHTML = `
    <h4>${title}</h4>
    ${description ? `<p class="rules">${description}</p>` : ''}
    <div class="game-preview-menu">
  `;
  menu.forEach(item => {
    previewHTML += `
      <div class="preview-menu-item">
        <span>${item.action}</span>
        <span class="tokens">${item.tokens} tokens</span>
      </div>
    `;
  });
  previewHTML += `</div>`;
  previewDiv.innerHTML = previewHTML;

  // 2. GENERATE COPY-PASTE TEXT
  let textOutput = `★ ${title.toUpperCase()} ★\n`;
  if (description) {
    textOutput += `${description}\n`;
  }
  textOutput += `-----------------------------\n`;
  
  // Custom icons based on indices for text version
  const bulletIcons = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅", "❖", "✦", "⚡", "❤"];
  menu.forEach((item, idx) => {
    const bullet = idx < bulletIcons.length ? bulletIcons[idx] : "✦";
    textOutput += `${bullet} Tip ${item.tokens} tokens: ${item.action}\n`;
  });
  textOutput += `-----------------------------`;

  document.getElementById("game-text-output").value = textOutput;
}

// ==========================================
// SUGGESTIONS BLUEPRINT GENERATION
// ==========================================

async function generateSuggestions() {
  const category = document.getElementById("sugg-category").value;
  const style = document.getElementById("sugg-style").value;
  const experience = document.getElementById("sugg-experience").value;
  const target = document.getElementById("sugg-target").value;

  const resultCard = document.getElementById("suggestions-result-card");
  const blueprintOutput = document.getElementById("blueprint-output");

  if (!blueprintOutput) return;

  blueprintOutput.innerHTML = `
    <div class="preview-placeholder">
      <div class="dot yellow"></div>
      <p>Analyzing profile attributes and compiling guidelines...</p>
    </div>
  `;

  try {
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, style, experience, target })
    });
    const data = await res.json();
    
    if (data.error) {
      blueprintOutput.innerHTML = `<div class="text-danger p-3">${data.error}</div>`;
      return;
    }

    const { suggestions } = data;
    
    let html = `
      <div class="blueprint-section">
        <h4><i data-lucide="compass"></i> Strategic Stream Focus</h4>
        <ul>
          ${suggestions.nicheSuggestions.map(item => `<li>${formatMarkdown(item)}</li>`).join('')}
        </ul>
      </div>
      
      <div class="blueprint-section">
        <h4><i data-lucide="dices"></i> High-Converting Tip Games</h4>
        <ul>
          ${suggestions.gameRecommendations.map(item => `<li>${formatMarkdown(item)}</li>`).join('')}
        </ul>
      </div>

      <div class="blueprint-section">
        <h4><i data-lucide="megaphone"></i> Out-Of-Stream Marketing & Funneling</h4>
        <ul>
          ${suggestions.marketingStrategy.map(item => `<li>${formatMarkdown(item)}</li>`).join('')}
        </ul>
      </div>

      <div class="blueprint-section">
        <h4><i data-lucide="check-square"></i> General Optimizations & Rules</h4>
        <ul>
          ${suggestions.generalTips.map(item => `<li>${formatMarkdown(item)}</li>`).join('')}
        </ul>
      </div>
    `;

    blueprintOutput.innerHTML = html;
    lucide.createIcons();

  } catch (err) {
    blueprintOutput.innerHTML = `<div class="text-danger p-3">Failed to load blueprint from backend. Check logs.</div>`;
  }
}

// Minimal markdown bold syntax converter
function formatMarkdown(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
