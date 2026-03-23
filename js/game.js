/**
 * Patches — game UI
 *
 * Wires ShikakuSolver + PuzzleGenerator to the DOM.
 * Handles: board rendering, drag interaction, win detection, timer.
 *
 * Each clue carries { row, col, value, shape } where shape is
 * 'square' | 'tall' | 'wide' | 'any' — matching LinkedIn's Patches mechanic.
 */

// ── Pastel patch colours (fill, border) ──────────────────────────────────────
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

// ── State ────────────────────────────────────────────────────────────────────
let puzzle   = null;   // { size, clues, solution }
let placed   = [];     // placed[i] = {r1,c1,r2,c2} | null, indexed by clue
let colorMap = [];     // colorMap[i] = color index for clue i

let dragStart = null;  // { row, col } | null
let isDragging = false;
let longPressTimer = null; // iOS long-press → remove patch

let timerInterval = null;
let startTime = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const boardEl       = document.getElementById('board');
const generatingEl  = document.getElementById('generating');
const winOverlay    = document.getElementById('win-overlay');
const winTimeEl     = document.getElementById('win-time');
const progressText  = document.getElementById('progress-text');
const timerEl       = document.getElementById('timer');
const sizeSelect    = document.getElementById('size-select');

document.getElementById('btn-new').addEventListener('click', startNewGame);
document.getElementById('btn-reset').addEventListener('click', resetGame);
document.getElementById('btn-win-new').addEventListener('click', startNewGame);

// ── Timer ────────────────────────────────────────────────────────────────────
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

// ── New game ─────────────────────────────────────────────────────────────────
function startNewGame() {
  const size = parseInt(sizeSelect.value, 10);
  winOverlay.classList.add('hidden');
  stopTimer();
  timerEl.textContent = '0:00';

  generatingEl.classList.remove('hidden');
  boardEl.style.visibility = 'hidden';

  // Run generation in a Web Worker so the UI stays responsive
  const worker = new Worker('js/worker.js');
  worker.onmessage = function (e) {
    worker.terminate();
    puzzle = e.data;

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

// ── Board rendering ───────────────────────────────────────────────────────────
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

  // Clue markers: shape icon + number
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col, value, shape } = puzzle.clues[i];
    cellEl(row, col).appendChild(makeClueEl(value, shape));
  }

  // Re-draw already-placed rectangles (e.g. after reset → renderBoard)
  for (let i = 0; i < placed.length; i++) {
    if (placed[i]) drawRect(placed[i], i);
  }
}

/**
 * Build the clue DOM node: a small shape icon with the number label.
 * Mirrors the LinkedIn Patches visual: darker shape badge + number.
 */
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

      // Thick outer border, thin inner dividers
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
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
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
  for (let r = Math.min(r1,r2); r <= Math.max(r1,r2); r++) {
    for (let c = Math.min(c1,c2); c <= Math.max(c1,c2); c++) {
      cellEl(r, c).classList.add(cls);
    }
  }
}

// ── Occupation helpers ────────────────────────────────────────────────────────
function occupiedBy(r, c) {
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (p && r >= p.r1 && r <= p.r2 && c >= p.c1 && c <= p.c2) return i;
  }
  return null;
}

// ── Placement logic ───────────────────────────────────────────────────────────
/**
 * Try to place a rectangle from (r1,c1) to (r2,c2).
 * Validates: exactly 1 clue inside, area matches, shape matches, no overlap.
 */
function tryPlace(r1, c1, r2, c2) {
  const nr1 = Math.min(r1, r2), nc1 = Math.min(c1, c2);
  const nr2 = Math.max(r1, r2), nc2 = Math.max(c1, c2);
  const h    = nr2 - nr1 + 1;
  const w    = nc2 - nc1 + 1;
  const area = h * w;

  // Must contain exactly 1 clue
  const inside = [];
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col } = puzzle.clues[i];
    if (row >= nr1 && row <= nr2 && col >= nc1 && col <= nc2) inside.push(i);
  }
  if (inside.length !== 1) return false;
  const ci = inside[0];
  const clue = puzzle.clues[ci];

  // Area must match clue value
  if (clue.value !== area) return false;

  // Shape must match clue shape constraint
  if (!ShikakuSolver.matchesShape(h, w, clue.shape)) return false;

  // No overlap with other patches
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
  winTimeEl.textContent = `Solved in ${elapsedStr()}`;
  winOverlay.classList.remove('hidden');
}

function updateProgress() {
  const done  = placed.filter(Boolean).length;
  const total = puzzle.clues.length;
  progressText.textContent = `${done} of ${total} patches placed`;
}

// ── Drag validity pre-check ───────────────────────────────────────────────────
/**
 * Returns true if the drag selection is a valid candidate:
 * exactly 1 clue inside, area matches, shape matches.
 */
function isValidDrag(r1, c1, r2, c2) {
  if (!puzzle) return false;
  const nr1=Math.min(r1,r2), nc1=Math.min(c1,c2);
  const nr2=Math.max(r1,r2), nc2=Math.max(c1,c2);
  const h = nr2-nr1+1, w = nc2-nc1+1;
  const area = h * w;

  let clueInside = null, count = 0;
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col } = puzzle.clues[i];
    if (row>=nr1&&row<=nr2&&col>=nc1&&col<=nc2) { count++; clueInside = i; }
  }
  if (count !== 1) return false;

  const clue = puzzle.clues[clueInside];
  return clue.value === area && ShikakuSolver.matchesShape(h, w, clue.shape);
}

// ── Mouse events ─────────────────────────────────────────────────────────────
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
  dragStart = cell;
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

// ── Touch events ──────────────────────────────────────────────────────────────
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

  // Long-press (500 ms) removes the patch under the finger — replaces right-click on iOS
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    // Only fire if the user hasn't dragged to another cell
    const stillOnStart = dragStart && dragStart.row === row && dragStart.col === col;
    if (stillOnStart && occupiedBy(row, col) !== null) {
      isDragging = false;
      dragStart  = null;
      clearPreview();
      removePatch(row, col);
      updateProgress();
      // Vibrate briefly as haptic feedback (supported on Android; no-op on iOS)
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

  // Cancel long-press if the finger moved to a different cell
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
  const nr1=Math.min(r1,r2), nc1=Math.min(c1,c2);
  const nr2=Math.max(r1,r2), nc2=Math.max(c1,c2);
  for (let r=nr1;r<=nr2;r++) {
    for (let c=nc1;c<=nc2;c++) {
      const el = cellEl(r, c);
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
startNewGame();
