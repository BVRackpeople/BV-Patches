/**
 * Patches — game UI
 *
 * Wires ShikakuSolver + PuzzleGenerator to the DOM.
 * Handles: board rendering, drag interaction, win detection, timer.
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

  // Show generating overlay while we work
  generatingEl.classList.remove('hidden');
  boardEl.style.visibility = 'hidden';

  // Defer so the DOM can paint the spinner
  setTimeout(() => {
    const gen = new PuzzleGenerator(size);
    puzzle = gen.generate();

    placed   = new Array(puzzle.clues.length).fill(null);
    colorMap = puzzle.clues.map((_, i) => i % PATCH_COLORS.length);
    // Shuffle color assignment so adjacent patches look distinct
    shuffleColorMap();

    renderBoard();
    generatingEl.classList.add('hidden');
    boardEl.style.visibility = 'visible';
    updateProgress();
    startTimer();
  }, 20);
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

      // Attach mouse/touch events
      cell.addEventListener('mousedown',  onMouseDown);
      cell.addEventListener('mousemove',  onMouseMove);
      cell.addEventListener('mouseup',    onMouseUp);
      cell.addEventListener('contextmenu', onRightClick);
      cell.addEventListener('touchstart', onTouchStart, { passive: false });
      cell.addEventListener('touchmove',  onTouchMove,  { passive: false });
      cell.addEventListener('touchend',   onTouchEnd,   { passive: false });

      boardEl.appendChild(cell);
    }
  }

  // Clue labels
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col, value } = puzzle.clues[i];
    const clueEl = document.createElement('span');
    clueEl.className = 'clue';
    clueEl.textContent = value;
    cellEl(row, col).appendChild(clueEl);
  }

  // Draw already-placed rectangles
  for (let i = 0; i < placed.length; i++) {
    if (placed[i]) drawRect(placed[i], i, false);
  }
}

function cellEl(r, c) {
  return boardEl.children[r * puzzle.size + c];
}

// ── Drawing patches ───────────────────────────────────────────────────────────
/**
 * Apply fill + thick border to cells of a placed rectangle.
 * @param {{ r1, c1, r2, c2 }} rect
 * @param {number} clueIdx
 * @param {boolean} preview
 */
function drawRect(rect, clueIdx, preview) {
  const { r1, c1, r2, c2 } = rect;
  const [fill, border] = PATCH_COLORS[colorMap[clueIdx] % PATCH_COLORS.length];

  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const el = cellEl(r, c);
      if (preview) {
        el.classList.add('preview');
        return; // handled differently below
      }
      el.classList.add('placed');
      el.style.background = fill;
      el.style.setProperty('--patch-border', border);

      // Thick border on outer edges only
      const borders = [];
      if (r === r1) borders.push('top');
      if (r === r2) borders.push('bottom');
      if (c === c1) borders.push('left');
      if (c === c2) borders.push('right');
      if (borders.length) el.dataset.border = borders.join(' ');
      else delete el.dataset.border;

      // Inner borders — thin separator
      if (r > r1) { el.style.borderTop    = '1px solid ' + border + '44'; }
      if (r < r2) { el.style.borderBottom = '1px solid ' + border + '44'; }
      if (c > c1) { el.style.borderLeft   = '1px solid ' + border + '44'; }
      if (c < c2) { el.style.borderRight  = '1px solid ' + border + '44'; }
    }
  }
}

/** Remove visual styling for a placed rectangle */
function eraseRect(rect) {
  const { r1, c1, r2, c2 } = rect;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const el = cellEl(r, c);
      el.classList.remove('placed', 'preview', 'preview-invalid');
      el.style.background = '';
      el.style.borderTop = el.style.borderBottom = '';
      el.style.borderLeft = el.style.borderRight = '';
      delete el.dataset.border;
    }
  }
}

/** Clear all preview highlights */
function clearPreview() {
  boardEl.querySelectorAll('.preview, .preview-invalid').forEach(el => {
    el.classList.remove('preview', 'preview-invalid');
    // Restore placed state if the cell was already placed
    // (handled by re-rendering, but we avoid full re-render for perf)
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    if (occupiedBy(r, c) !== null) {
      const ci = occupiedBy(r, c);
      const [fill] = PATCH_COLORS[colorMap[ci] % PATCH_COLORS.length];
      el.style.background = fill;
    }
  });
}

/** Show drag preview rectangle */
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
/** Returns clue index that occupies (r,c), or null */
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
 * Returns true if successful.
 */
function tryPlace(r1, c1, r2, c2) {
  // Normalise
  const nr1 = Math.min(r1, r2), nc1 = Math.min(c1, c2);
  const nr2 = Math.max(r1, r2), nc2 = Math.max(c1, c2);
  const area = (nr2 - nr1 + 1) * (nc2 - nc1 + 1);

  // Find clues inside this rect
  const inside = [];
  for (let i = 0; i < puzzle.clues.length; i++) {
    const { row, col, value } = puzzle.clues[i];
    if (row >= nr1 && row <= nr2 && col >= nc1 && col <= nc2) inside.push(i);
  }

  if (inside.length !== 1) return false;        // must contain exactly 1 clue
  const ci = inside[0];
  if (puzzle.clues[ci].value !== area) return false; // area must match

  // Check no cell is already occupied by another clue's rect
  for (let r = nr1; r <= nr2; r++) {
    for (let c = nc1; c <= nc2; c++) {
      const occ = occupiedBy(r, c);
      if (occ !== null && occ !== ci) return false; // overlap with another patch
    }
  }

  // Remove previous placement for this clue if any
  if (placed[ci]) eraseRect(placed[ci]);

  placed[ci] = { r1: nr1, c1: nc1, r2: nr2, c2: nc2 };
  drawRect(placed[ci], ci, false);
  return true;
}

/** Remove the patch that covers cell (r,c) */
function removePatch(r, c) {
  const ci = occupiedBy(r, c);
  if (ci === null) return;
  eraseRect(placed[ci]);
  placed[ci] = null;
}

// ── Win check ─────────────────────────────────────────────────────────────────
function checkWin() {
  if (placed.some(p => p === null)) return;
  // All cells must be covered (guaranteed if all rects placed and no gaps exist)
  stopTimer();
  const elapsed = elapsedStr();
  winTimeEl.textContent = `Solved in ${elapsed}`;
  winOverlay.classList.remove('hidden');
}

function updateProgress() {
  const done  = placed.filter(Boolean).length;
  const total = puzzle.clues.length;
  progressText.textContent = `${done} of ${total} patches placed`;
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
  if (e.button === 2) return; // handled by contextmenu
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
  const valid = isValidDrag(dragStart.row, dragStart.col, cell.row, cell.col);
  showPreview(dragStart.row, dragStart.col, cell.row, cell.col, valid);
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

// Global mouseup so drag doesn't get stuck if mouse leaves board
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
  const target = document.elementFromPoint(coords.clientX, coords.clientY);
  if (!target) return;
  const cell = target.closest('.cell');
  if (!cell) return;
  dragStart  = { row: parseInt(cell.dataset.row), col: parseInt(cell.dataset.col) };
  isDragging = true;
}

function onTouchMove(e) {
  e.preventDefault();
  if (!isDragging || !dragStart) return;
  const coords = touchCoords(e);
  const target = document.elementFromPoint(coords.clientX, coords.clientY);
  if (!target) return;
  const cell = target.closest('.cell');
  if (!cell) return;
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
  showPreview(dragStart.row, dragStart.col, row, col,
              isValidDrag(dragStart.row, dragStart.col, row, col));
}

function onTouchEnd(e) {
  if (!isDragging || !dragStart) return;
  e.preventDefault();
  isDragging = false;
  clearPreview();
  const coords = touchCoords(e);
  const target = document.elementFromPoint(coords.clientX, coords.clientY);
  if (!target) { dragStart = null; return; }
  const cell = target.closest('.cell');
  if (!cell) { dragStart = null; return; }
  const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
  const ok = tryPlace(dragStart.row, dragStart.col, row, col);
  if (!ok) flashCells(dragStart.row, dragStart.col, row, col);
  dragStart = null;
  updateProgress();
  if (ok) checkWin();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Quick pre-check: the drag selection contains exactly 1 clue with matching area */
function isValidDrag(r1, c1, r2, c2) {
  if (!puzzle) return false;
  const nr1=Math.min(r1,r2), nc1=Math.min(c1,c2);
  const nr2=Math.max(r1,r2), nc2=Math.max(c1,c2);
  const area = (nr2-nr1+1)*(nc2-nc1+1);
  let inside = 0, matchArea = false;
  for (const { row, col, value } of puzzle.clues) {
    if (row>=nr1&&row<=nr2&&col>=nc1&&col<=nc2) { inside++; if(value===area) matchArea=true; }
  }
  return inside === 1 && matchArea;
}

/** Flash cells red to indicate invalid placement */
function flashCells(r1, c1, r2, c2) {
  const nr1=Math.min(r1,r2), nc1=Math.min(c1,c2);
  const nr2=Math.max(r1,r2), nc2=Math.max(c1,c2);
  for (let r=nr1;r<=nr2;r++) {
    for (let c=nc1;c<=nc2;c++) {
      const el = cellEl(r, c);
      el.classList.remove('flash');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('flash');
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
startNewGame();
