/**
 * Patches — game UI
 *
 * Screens: home → difficulty → [levels] → game
 *          home → stats
 *
 * Modes:
 *   progress — plays pre-made levels from LEVELS[size][idx]
 *   freeplay — auto-generates via Web Worker
 */

// ── Pastel patch colours ──────────────────────────────────────────────────────
const PATCH_COLORS = [
  ['#ffd6a5', '#e8a04a'],
  ['#caffbf', '#5ab552'],
  ['#9bf6ff', '#3abfcc'],
  ['#bdb2ff', '#7e72e8'],
  ['#ffc6ff', '#d078d0'],
  ['#ffadad', '#d85050'],
  ['#a0c4ff', '#4a85d8'],
  ['#fdffb6', '#c8ca50'],
  ['#c9e4de', '#5a9e8e'],
  ['#f4c7c3', '#c07070'],
];

// ── Difficulty metadata ───────────────────────────────────────────────────────
const DIFF = {
  5: { label: 'Easy',   color: '#2e7d32' },
  6: { label: 'Medium', color: '#f57c00' },
  7: { label: 'Hard',   color: '#c62828' },
  8: { label: 'Expert', color: '#6a1b9a' },
  9: { label: 'Master', color: '#1a237e' },
};

// ── localStorage keys ─────────────────────────────────────────────────────────
const STORAGE_PROGRESS = 'patches_progress'; // {5:{0:{done,time},...},...}
const STORAGE_STATS    = 'patches_stats';    // see saveStats()

// ── Navigation state ──────────────────────────────────────────────────────────
let navMode  = null; // 'progress' | 'freeplay'
let navSize  = null; // 5–9
let navLevel = null; // 0–99 (progress only)

// ── Game state ────────────────────────────────────────────────────────────────
let puzzle   = null; // { size, clues }
let placed   = [];   // placed[i] = {r1,c1,r2,c2} | null, indexed by clue
let colorMap = [];   // colorMap[i] = PATCH_COLORS index for clue i

let dragStart     = null;
let isDragging    = false;
let longPressTimer = null;

let timerInterval = null;
let startTime     = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const boardEl      = document.getElementById('board');
const generatingEl = document.getElementById('generating');
const winOverlay   = document.getElementById('win-overlay');
const winTimeEl    = document.getElementById('win-time');
const progressText = document.getElementById('progress-text');
const timerEl      = document.getElementById('timer');

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

function goHome() {
  stopTimer();
  puzzle = null;
  showScreen('home');
}

// Called by home screen "Progress Mode" / "Free Play" buttons
function goToDifficulty(mode) {
  navMode = mode;

  const grid = document.getElementById('diff-grid');
  const progress = loadProgress();
  grid.innerHTML = '';

  for (const size of [5, 6, 7, 8, 9]) {
    const d   = DIFF[size];
    const btn = document.createElement('button');
    btn.className = 'diff-btn';

    let progressHtml = '';
    if (mode === 'progress') {
      const done = Object.values(progress[size] || {}).filter(v => v.done).length;
      progressHtml = `<span class="diff-progress">${done} / 100</span>`;
    }

    btn.innerHTML = `
      <span class="diff-label" style="color:${d.color}">${d.label}</span>
      <span class="diff-grid-size">${size} × ${size}</span>
      ${progressHtml}
    `;
    btn.onclick = () => selectDifficulty(size);
    grid.appendChild(btn);
  }

  document.getElementById('diff-title').textContent =
    mode === 'progress' ? 'Progress Mode — Choose Difficulty'
                        : 'Free Play — Choose Difficulty';
  showScreen('difficulty');
}

function selectDifficulty(size) {
  navSize = size;
  if (navMode === 'progress') {
    renderLevelSelect(size);
    showScreen('levels');
  } else {
    startFreePlay(size);
  }
}

// Back button from game screen — context-aware
function goBack() {
  stopTimer();
  puzzle = null;
  winOverlay.classList.add('hidden');
  if (navMode === 'progress') {
    renderLevelSelect(navSize);
    showScreen('levels');
  } else {
    goToDifficulty('freeplay');
  }
}

// ── Level Select ──────────────────────────────────────────────────────────────
function renderLevelSelect(size) {
  const d = DIFF[size];
  document.getElementById('levels-title').textContent =
    `${d.label} (${size}×${size}) — Select Level`;

  const grid     = document.getElementById('levels-grid');
  const progress = loadProgress();
  const sizeProg = progress[size] || {};
  grid.innerHTML = '';

  for (let i = 0; i < 100; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    const rec = sizeProg[i];
    if (rec && rec.done) {
      btn.classList.add('done');
      const m = Math.floor(rec.time / 60);
      const s = String(rec.time % 60).padStart(2, '0');
      btn.title = `Best: ${m}:${s}`;
      btn.innerHTML = `<span class="lvl-num">${i + 1}</span><span class="lvl-check">✓</span>`;
    } else {
      btn.innerHTML = `<span class="lvl-num">${i + 1}</span>`;
    }
    btn.onclick = () => startProgressLevel(size, i);
    grid.appendChild(btn);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME START
// ═══════════════════════════════════════════════════════════════════════════════

function startProgressLevel(size, idx) {
  navSize  = size;
  navLevel = idx;

  const d         = DIFF[size];
  const levelData = LEVELS[size][idx];
  puzzle   = { size, clues: levelData.clues };
  placed   = new Array(puzzle.clues.length).fill(null);
  colorMap = puzzle.clues.map((_, i) => i % PATCH_COLORS.length);
  shuffleColorMap();

  document.getElementById('game-subtitle').textContent =
    `${d.label} — Level ${idx + 1}`;
  document.getElementById('btn-new').classList.add('hidden');

  winOverlay.classList.add('hidden');
  stopTimer();
  timerEl.textContent = '0:00';
  generatingEl.classList.add('hidden');
  boardEl.style.visibility = 'visible';

  renderBoard();
  updateProgress();
  startTimer();
  showScreen('game');
}

function startFreePlay(size) {
  navSize  = size;
  navLevel = null;

  const d = DIFF[size];
  document.getElementById('game-subtitle').textContent = `${d.label} — Free Play`;
  document.getElementById('btn-new').classList.remove('hidden');

  winOverlay.classList.add('hidden');
  stopTimer();
  timerEl.textContent = '0:00';
  generatingEl.classList.remove('hidden');
  boardEl.style.visibility = 'hidden';
  boardEl.innerHTML = '';

  showScreen('game');

  const worker = new Worker('js/worker.js');
  worker.onmessage = function (e) {
    worker.terminate();
    puzzle   = e.data;
    placed   = new Array(puzzle.clues.length).fill(null);
    colorMap = puzzle.clues.map((_, i) => i % PATCH_COLORS.length);
    shuffleColorMap();

    renderBoard();
    generatingEl.classList.add('hidden');
    boardEl.style.visibility = 'visible';
    updateProgress();
    startTimer();
  };
  worker.postMessage({ size });
}

function shuffleColorMap() {
  for (let i = colorMap.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colorMap[i], colorMap[j]] = [colorMap[j], colorMap[i]];
  }
}

function resetGame() {
  if (!puzzle) return;
  placed = new Array(puzzle.clues.length).fill(null);
  winOverlay.classList.add('hidden');
  stopTimer();
  startTimer();
  renderBoard();
  updateProgress();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

function goToStats() {
  renderStats();
  showScreen('stats');
}

function renderStats() {
  const stats    = loadStats();
  const progress = loadProgress();
  const el       = document.getElementById('stats-content');

  const totalSecs = stats.totalTime || 0;
  const totalH    = Math.floor(totalSecs / 3600);
  const totalM    = Math.floor((totalSecs % 3600) / 60);
  const totalTimeStr = totalH > 0
    ? `${totalH}h ${totalM}m`
    : `${totalM}m ${String(totalSecs % 60).padStart(2,'0')}s`;

  const totalCount = stats.total || 0;
  const avgSecs = totalCount > 0 ? Math.round(totalSecs / totalCount) : null;
  const avgTimeStr = avgSecs !== null
    ? `${Math.floor(avgSecs / 60)}:${String(avgSecs % 60).padStart(2, '0')}`
    : '—';

  let html = `
    <div class="stats-section">
      <h3>Overall</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val">${totalCount}</div>
          <div class="stat-lbl">Puzzles solved</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${totalTimeStr}</div>
          <div class="stat-lbl">Total play time</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${avgTimeStr}</div>
          <div class="stat-lbl">Avg time</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.streak || 0}</div>
          <div class="stat-lbl">Current streak</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.bestStreak || 0}</div>
          <div class="stat-lbl">Best streak</div>
        </div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Progress Mode</h3>
      <table class="stats-table">
        <thead><tr><th>Difficulty</th><th>Completed</th><th>Best time</th><th>Avg time</th></tr></thead>
        <tbody>
  `;

  for (const size of [5, 6, 7, 8, 9]) {
    const d      = DIFF[size];
    const data   = progress[size] || {};
    const done   = Object.values(data).filter(v => v.done).length;
    const times  = Object.values(data).filter(v => v.done).map(v => v.time);
    const best   = times.length ? Math.min(...times) : null;
    const bestStr = best !== null
      ? `${Math.floor(best / 60)}:${String(best % 60).padStart(2, '0')}`
      : '—';
    const avgT = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    const avgTStr = avgT !== null
      ? `${Math.floor(avgT / 60)}:${String(avgT % 60).padStart(2, '0')}`
      : '—';
    html += `<tr>
      <td><span style="color:${d.color}">●</span> ${d.label}</td>
      <td>${done} / 100</td>
      <td>${bestStr}</td>
      <td>${avgTStr}</td>
    </tr>`;
  }

  html += `</tbody></table></div>

    <div class="stats-section">
      <h3>Free Play</h3>
      <table class="stats-table">
        <thead><tr><th>Difficulty</th><th>Solved</th><th>Best time</th><th>Avg time</th></tr></thead>
        <tbody>
  `;

  for (const size of [5, 6, 7, 8, 9]) {
    const d     = DIFF[size];
    const fp    = (stats.freeplay || {})[size] || {};
    const count = fp.count || 0;
    const best  = fp.best != null
      ? `${Math.floor(fp.best / 60)}:${String(fp.best % 60).padStart(2, '0')}`
      : '—';
    const fpAvg = (count > 0 && fp.totalTime != null)
      ? Math.round(fp.totalTime / count)
      : null;
    const fpAvgStr = fpAvg !== null
      ? `${Math.floor(fpAvg / 60)}:${String(fpAvg % 60).padStart(2, '0')}`
      : '—';
    html += `<tr>
      <td><span style="color:${d.color}">●</span> ${d.label}</td>
      <td>${count}</td>
      <td>${best}</td>
      <td>${fpAvgStr}</td>
    </tr>`;
  }

  html += `</tbody></table></div>
    <div class="stats-section stats-reset">
      <button class="btn btn-secondary" id="btn-reset-stats">Reset All Statistics</button>
    </div>
  `;

  el.innerHTML = html;

  document.getElementById('btn-reset-stats').onclick = () => {
    if (confirm('Reset all statistics and progress? This cannot be undone.')) {
      localStorage.removeItem(STORAGE_PROGRESS);
      localStorage.removeItem(STORAGE_STATS);
      renderStats();
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCALSTORAGE
// ═══════════════════════════════════════════════════════════════════════════════

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PROGRESS) || '{}'); }
  catch { return {}; }
}

function saveProgress(size, idx, timeSeconds) {
  const p = loadProgress();
  if (!p[size]) p[size] = {};
  const prev = p[size][idx];
  if (!prev || timeSeconds < prev.time) {
    p[size][idx] = { done: true, time: timeSeconds };
  }
  localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(p));
}

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_STATS) || '{}'); }
  catch { return {}; }
}

function saveStats(size, timeSeconds) {
  const s = loadStats();
  s.total     = (s.total || 0) + 1;
  s.totalTime = (s.totalTime || 0) + timeSeconds;

  // Daily streak
  const today = new Date().toISOString().slice(0, 10);
  if (s.lastDate !== today) {
    s.streak = (s.lastDate === _prevDay(today)) ? (s.streak || 0) + 1 : 1;
    s.lastDate = today;
  }
  s.bestStreak = Math.max(s.bestStreak || 0, s.streak);

  // Free play stats
  if (navMode === 'freeplay') {
    if (!s.freeplay) s.freeplay = {};
    if (!s.freeplay[size]) s.freeplay[size] = { count: 0, best: null };
    s.freeplay[size].count++;
    if (s.freeplay[size].best === null || timeSeconds < s.freeplay[size].best) {
      s.freeplay[size].best = timeSeconds;
    }
    s.freeplay[size].totalTime = (s.freeplay[size].totalTime || 0) + timeSeconds;
  }

  localStorage.setItem(STORAGE_STATS, JSON.stringify(s));
}

function _prevDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════════════════════════════════

function startTimer() {
  stopTimer();
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function elapsedStr() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function elapsedSecs() {
  return Math.floor((Date.now() - startTime) / 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function renderBoard() {
  const { size } = puzzle;
  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.innerHTML = '';

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      cell.addEventListener('mousedown',   onMouseDown);
      cell.addEventListener('mousemove',   onMouseMove);
      cell.addEventListener('mouseup',     onMouseUp);
      cell.addEventListener('contextmenu', onRightClick);
      cell.addEventListener('touchstart',  onTouchStart, { passive: false });
      cell.addEventListener('touchmove',   onTouchMove,  { passive: false });
      cell.addEventListener('touchend',    onTouchEnd,   { passive: false });

      boardEl.appendChild(cell);
    }
  }

  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col, value, shape } = puzzle.clues[i];
    cellEl(row, col).appendChild(makeClueEl(value, shape));
  }

  for (let i = 0; i < placed.length; i++) {
    if (placed[i]) drawRect(placed[i], i);
  }
}

function makeClueEl(value, shape) {
  const wrap = document.createElement('div');
  wrap.className = 'clue';
  const icon = document.createElement('div');
  icon.className = `shape-icon shape-${shape}`;
  const num = document.createElement('span');
  num.className = 'clue-num';
  num.textContent = value;
  wrap.appendChild(icon);
  wrap.appendChild(num);
  return wrap;
}

function cellEl(r, c) {
  return boardEl.children[r * puzzle.size + c];
}

// ── Drawing patches ───────────────────────────────────────────────────────────

function drawRect(rect, clueIdx) {
  const { r1, c1, r2, c2 } = rect;
  const [fill, border] = PATCH_COLORS[colorMap[clueIdx] % PATCH_COLORS.length];

  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const el = cellEl(r, c);
      el.classList.add('placed');
      el.style.background = fill;
      el.style.setProperty('--patch-border', border);

      const bt = r === r1 ? `2px solid ${border}` : `1px solid ${border}44`;
      const bb = r === r2 ? `2px solid ${border}` : `1px solid ${border}44`;
      const bl = c === c1 ? `2px solid ${border}` : `1px solid ${border}44`;
      const br = c === c2 ? `2px solid ${border}` : `1px solid ${border}44`;
      el.style.borderTop    = bt;
      el.style.borderBottom = bb;
      el.style.borderLeft   = bl;
      el.style.borderRight  = br;
    }
  }
}

function eraseRect(rect) {
  const { r1, c1, r2, c2 } = rect;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const el = cellEl(r, c);
      el.classList.remove('placed', 'preview', 'preview-invalid');
      el.style.background = '';
      el.style.borderTop = el.style.borderBottom = '';
      el.style.borderLeft = el.style.borderRight = '';
    }
  }
}

function clearPreview() {
  boardEl.querySelectorAll('.preview, .preview-invalid').forEach(el => {
    el.classList.remove('preview', 'preview-invalid');
    const r  = parseInt(el.dataset.row);
    const c  = parseInt(el.dataset.col);
    const ci = occupiedBy(r, c);
    if (ci !== null) {
      const [fill] = PATCH_COLORS[colorMap[ci] % PATCH_COLORS.length];
      el.style.background = fill;
    }
  });
}

function showPreview(r1, c1, r2, c2, valid) {
  clearPreview();
  const cls = valid ? 'preview' : 'preview-invalid';
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      cellEl(r, c).classList.add(cls);
    }
  }
}

// ── Occupation helper ─────────────────────────────────────────────────────────

function occupiedBy(r, c) {
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (p && r >= p.r1 && r <= p.r2 && c >= p.c1 && c <= p.c2) return i;
  }
  return null;
}

// ── Placement logic ───────────────────────────────────────────────────────────

function tryPlace(r1, c1, r2, c2) {
  const nr1 = Math.min(r1, r2), nc1 = Math.min(c1, c2);
  const nr2 = Math.max(r1, r2), nc2 = Math.max(c1, c2);
  const h    = nr2 - nr1 + 1;
  const w    = nc2 - nc1 + 1;
  const area = h * w;

  const inside = [];
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col } = puzzle.clues[i];
    if (row >= nr1 && row <= nr2 && col >= nc1 && col <= nc2) inside.push(i);
  }
  if (inside.length !== 1) return false;

  const ci   = inside[0];
  const clue = puzzle.clues[ci];

  if (clue.value !== area) return false;
  if (!ShikakuSolver.matchesShape(h, w, clue.shape)) return false;

  for (let r = nr1; r <= nr2; r++) {
    for (let c = nc1; c <= nc2; c++) {
      const occ = occupiedBy(r, c);
      if (occ !== null && occ !== ci) return false;
    }
  }

  if (placed[ci]) eraseRect(placed[ci]);
  placed[ci] = { r1: nr1, c1: nc1, r2: nr2, c2: nc2 };
  drawRect(placed[ci], ci);
  return true;
}

function removePatch(r, c) {
  const ci = occupiedBy(r, c);
  if (ci === null) return;
  eraseRect(placed[ci]);
  placed[ci] = null;
}

// ── Win check ─────────────────────────────────────────────────────────────────

function checkWin() {
  if (placed.some(p => p === null)) return;
  stopTimer();
  const secs = elapsedSecs();

  // Persist
  saveStats(navSize, secs);
  if (navMode === 'progress') saveProgress(navSize, navLevel, secs);

  // Win overlay copy
  winTimeEl.textContent = `Solved in ${elapsedStr()}`;

  const btnNext = document.getElementById('btn-win-next');
  const btnNew  = document.getElementById('btn-win-new');
  const btnBack = document.getElementById('btn-win-back');

  if (navMode === 'progress') {
    btnNext.classList.toggle('hidden', navLevel >= 99);
    btnNew.classList.add('hidden');
    btnBack.textContent = 'Back to Levels';
  } else {
    btnNext.classList.add('hidden');
    btnNew.classList.remove('hidden');
    btnBack.textContent = 'Back';
  }

  winOverlay.classList.remove('hidden');
}

function updateProgress() {
  const done  = placed.filter(Boolean).length;
  const total = puzzle.clues.length;
  progressText.textContent = `${done} of ${total} patches placed`;
}

// ── Drag validity pre-check ───────────────────────────────────────────────────

function isValidDrag(r1, c1, r2, c2) {
  if (!puzzle) return false;
  const nr1 = Math.min(r1, r2), nc1 = Math.min(c1, c2);
  const nr2 = Math.max(r1, r2), nc2 = Math.max(c1, c2);
  const h = nr2 - nr1 + 1, w = nc2 - nc1 + 1;

  let clueInside = null, count = 0;
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col } = puzzle.clues[i];
    if (row >= nr1 && row <= nr2 && col >= nc1 && col <= nc2) { count++; clueInside = i; }
  }
  if (count !== 1) return false;
  const clue = puzzle.clues[clueInside];
  return clue.value === h * w && ShikakuSolver.matchesShape(h, w, clue.shape);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOUSE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

function cellFromEvent(e) {
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target) return null;
  const cell = target.closest('.cell');
  if (!cell) return null;
  return { row: parseInt(cell.dataset.row), col: parseInt(cell.dataset.col) };
}

function onMouseDown(e) {
  if (e.button === 2) return;
  e.preventDefault();
  const cell = cellFromEvent(e);
  if (!cell) return;
  dragStart  = cell;
  isDragging = true;
  showPreview(cell.row, cell.col, cell.row, cell.col, true);
}

function onMouseMove(e) {
  if (!isDragging || !dragStart) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  showPreview(dragStart.row, dragStart.col, cell.row, cell.col,
              isValidDrag(dragStart.row, dragStart.col, cell.row, cell.col));
}

function onMouseUp(e) {
  if (!isDragging || !dragStart) return;
  isDragging = false;
  clearPreview();
  const cell = cellFromEvent(e);
  if (!cell) { dragStart = null; return; }
  const ok = tryPlace(dragStart.row, dragStart.col, cell.row, cell.col);
  if (!ok) flashCells(dragStart.row, dragStart.col, cell.row, cell.col);
  dragStart = null;
  updateProgress();
  if (ok) checkWin();
}

function onRightClick(e) {
  e.preventDefault();
  const cell = cellFromEvent(e);
  if (!cell) return;
  removePatch(cell.row, cell.col);
  updateProgress();
}

document.addEventListener('mouseup', () => {
  if (isDragging) { isDragging = false; dragStart = null; clearPreview(); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOUCH EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

function touchCoords(e) {
  const t = e.touches[0] || e.changedTouches[0];
  return { clientX: t.clientX, clientY: t.clientY };
}

function onTouchStart(e) {
  e.preventDefault();
  const coords = touchCoords(e);
  const cell = document.elementFromPoint(coords.clientX, coords.clientY)?.closest('.cell');
  if (!cell) return;
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
  dragStart  = { row, col };
  isDragging = true;

  // 500 ms long-press → remove patch (replaces right-click on iOS)
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    const stillOnStart = dragStart && dragStart.row === row && dragStart.col === col;
    if (stillOnStart && occupiedBy(row, col) !== null) {
      isDragging = false;
      dragStart  = null;
      clearPreview();
      removePatch(row, col);
      updateProgress();
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, 500);
}

function onTouchMove(e) {
  e.preventDefault();
  if (!isDragging || !dragStart) return;
  const coords = touchCoords(e);
  const cell = document.elementFromPoint(coords.clientX, coords.clientY)?.closest('.cell');
  if (!cell) return;
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);

  if (longPressTimer && (row !== dragStart.row || col !== dragStart.col)) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  showPreview(dragStart.row, dragStart.col, row, col,
              isValidDrag(dragStart.row, dragStart.col, row, col));
}

function onTouchEnd(e) {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  if (!isDragging || !dragStart) return;
  e.preventDefault();
  isDragging = false;
  clearPreview();
  const coords = touchCoords(e);
  const cell = document.elementFromPoint(coords.clientX, coords.clientY)?.closest('.cell');
  if (!cell) { dragStart = null; return; }
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
  const ok = tryPlace(dragStart.row, dragStart.col, row, col);
  if (!ok) flashCells(dragStart.row, dragStart.col, row, col);
  dragStart = null;
  updateProgress();
  if (ok) checkWin();
}

// ── Flash animation ───────────────────────────────────────────────────────────

function flashCells(r1, c1, r2, c2) {
  const nr1 = Math.min(r1, r2), nc1 = Math.min(c1, c2);
  const nr2 = Math.max(r1, r2), nc2 = Math.max(c1, c2);
  for (let r = nr1; r <= nr2; r++) {
    for (let c = nc1; c <= nc2; c++) {
      const el = cellEl(r, c);
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('btn-progress-mode').onclick = () => goToDifficulty('progress');
document.getElementById('btn-freeplay-mode').onclick = () => goToDifficulty('freeplay');
document.getElementById('btn-stats').onclick         = goToStats;
document.getElementById('diff-back').onclick         = goHome;
document.getElementById('levels-back').onclick       = () => goToDifficulty('progress');
document.getElementById('stats-back').onclick        = goHome;
document.getElementById('btn-back-game').onclick     = goBack;
document.getElementById('btn-reset').onclick         = resetGame;
document.getElementById('btn-new').onclick           = () => startFreePlay(navSize);
document.getElementById('btn-win-next').onclick      = () => startProgressLevel(navSize, navLevel + 1);
document.getElementById('btn-win-new').onclick       = () => startFreePlay(navSize);
document.getElementById('btn-win-back').onclick      = () => {
  winOverlay.classList.add('hidden');
  goBack();
};
