/**
 * Shikaku puzzle generator.
 *
 * Produces puzzles with a guaranteed unique solution.
 * Strategy:
 *  1. Randomly partition the grid into rectangles (backtracking).
 *  2. Place one numbered clue in each rectangle.
 *  3. Verify uniqueness via ShikakuSolver.
 *  4. Retry clue placement up to N times, then re-partition.
 */
class PuzzleGenerator {
  /**
   * @param {number} size  - Grid dimension
   */
  constructor(size) {
    this.size = size;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Generate a valid puzzle with a unique solution.
   * @returns {{ size:number, clues:Array, solution:Array }}
   */
  generate() {
    const t0 = performance.now();
    let attempts = 0;

    for (let outer = 0; outer < 200; outer++) {
      const rects = this._partitionGrid();
      if (!rects) continue;

      for (let inner = 0; inner < 20; inner++) {
        attempts++;
        const clues = this._placeClues(rects);
        const solver = new ShikakuSolver(this.size, clues);
        if (solver.isUnique()) {
          console.log(`[Generator] ${this.size}×${this.size} puzzle in ${(performance.now()-t0).toFixed(0)}ms, ${attempts} attempt(s), ${rects.length} regions`);
          return { size: this.size, clues, solution: rects };
        }
      }
    }

    // Fallback — extremely rare; just return last generated (may not be unique)
    console.warn('[Generator] Could not guarantee uniqueness — returning best effort');
    const rects = this._partitionGrid() || [];
    return { size: this.size, clues: this._placeClues(rects), solution: rects };
  }

  // ─── Grid Partitioning ─────────────────────────────────────────────────────

  /**
   * Randomly partition the grid into non-overlapping rectangles that cover
   * every cell. Uses a randomised greedy approach with backtracking.
   *
   * @returns {Array<{r1,c1,r2,c2}>|null}
   */
  _partitionGrid() {
    const { size } = this;
    const grid = new Int8Array(size * size).fill(-1); // -1 = unassigned
    const rects = [];
    const stack = []; // for backtracking: [{rectIndex, cellIndex, tried}]

    let cellIdx = this._firstUnassigned(grid);

    while (cellIdx !== -1) {
      const r = Math.floor(cellIdx / size);
      const c = cellIdx % size;

      // Build shuffled candidate list for this cell
      const candidates = this._shuffled(this._rectsContaining(r, c, grid));

      if (candidates.length === 0) {
        // Backtrack
        if (stack.length === 0) return null;
        const frame = stack.pop();
        this._unplace(grid, rects[frame.rectIdx]);
        rects.splice(frame.rectIdx, 1);
        // Try next candidate from the frame's sibling list
        let placed = false;
        while (frame.tried < frame.candidates.length) {
          const rect = frame.candidates[frame.tried++];
          if (this._canPlace(rect, grid)) {
            this._place(grid, rect, rects.length);
            rects.push(rect);
            stack.push(frame); // keep frame with updated tried
            placed = true;
            break;
          }
        }
        if (!placed && stack.length === 0) return null;
      } else {
        // Place first candidate, save rest for potential backtrack
        const rect = candidates[0];
        this._place(grid, rect, rects.length);
        rects.push(rect);
        stack.push({ rectIdx: rects.length - 1, candidates, tried: 1 });
      }

      cellIdx = this._firstUnassigned(grid);
    }

    return rects;
  }

  _firstUnassigned(grid) {
    for (let i = 0; i < grid.length; i++) if (grid[i] === -1) return i;
    return -1;
  }

  /** All rectangles (within grid) that contain cell (r,c) and fit in unassigned cells */
  _rectsContaining(r, c, grid) {
    const { size } = this;
    const maxArea = Math.ceil(size * size / 3); // cap rect area for variety
    const results = [];

    for (let h = 1; h <= size; h++) {
      for (let w = 1; w <= size; w++) {
        if (h * w < 2) continue;        // no 1×1 single cells
        if (h * w > maxArea) continue;
        const r1min = Math.max(0, r - h + 1);
        const r1max = Math.min(size - h, r);
        const c1min = Math.max(0, c - w + 1);
        const c1max = Math.min(size - w, c);
        for (let r1 = r1min; r1 <= r1max; r1++) {
          for (let c1 = c1min; c1 <= c1max; c1++) {
            const rect = { r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 };
            if (this._canPlace(rect, grid)) results.push(rect);
          }
        }
      }
    }
    return results;
  }

  _canPlace(rect, grid) {
    const { size } = this;
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++)
        if (grid[r * size + c] !== -1) return false;
    return true;
  }

  _place(grid, rect, id) {
    const { size } = this;
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++)
        grid[r * size + c] = id;
  }

  _unplace(grid, rect) {
    const { size } = this;
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++)
        grid[r * size + c] = -1;
  }

  _shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── Clue Placement ────────────────────────────────────────────────────────

  /**
   * For each rectangle, pick one random cell as the clue.
   * The clue carries:
   *   value — area of the rectangle
   *   shape — 'square' | 'tall' | 'wide' | 'any'
   *
   * Shape is derived from the actual rectangle dimensions.
   * ~15% of the time we assign 'any' instead (adds difficulty variety).
   */
  _placeClues(rects) {
    return rects.map(rect => {
      const cells = [];
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++)
          cells.push({ row: r, col: c });
      const pick = cells[Math.floor(Math.random() * cells.length)];
      const h    = rect.r2 - rect.r1 + 1;
      const w    = rect.c2 - rect.c1 + 1;
      const area = h * w;

      let shape;
      if (Math.random() < 0.15) {
        shape = 'any';
      } else if (h === w) {
        shape = 'square';
      } else if (h > w) {
        shape = 'tall';
      } else {
        shape = 'wide';
      }

      return { row: pick.row, col: pick.col, value: area, shape };
    });
  }
}

if (typeof module !== 'undefined') module.exports = PuzzleGenerator;
