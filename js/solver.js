/**
 * Shikaku solver: constraint propagation + backtracking.
 *
 * A Shikaku puzzle is a grid partitioned into rectangles.
 * Each clue { row, col, value } sits inside exactly one rectangle
 * whose area equals `value`. No overlaps, no gaps.
 */
class ShikakuSolver {
  /**
   * @param {number} size   - Grid dimension (size × size)
   * @param {Array<{row:number,col:number,value:number}>} clues
   */
  constructor(size, clues) {
    this.size = size;
    this.clues = clues;
  }

  /**
   * Enumerate every axis-aligned rectangle that:
   *  - Stays within grid bounds
   *  - Contains clue cell (cr, cc)
   *  - Has area equal to clue.value
   *  - Does NOT contain any other clue cell
   *
   * @param {number} ci  - Clue index
   * @returns {Array<{r1,c1,r2,c2}>}
   */
  getCandidates(ci) {
    const { size, clues } = this;
    const clue = clues[ci];
    const { row: cr, col: cc, value: area } = clue;
    const results = [];

    // Build a fast lookup of other clue positions
    const otherClues = new Set();
    for (let i = 0; i < clues.length; i++) {
      if (i !== ci) otherClues.add(clues[i].row * size + clues[i].col);
    }

    // Try every rectangle of the correct area
    for (let h = 1; h <= size; h++) {
      if (area % h !== 0) continue;
      const w = area / h;
      if (w > size) continue;

      // All top-left positions where this h×w rect contains (cr, cc)
      const r1min = Math.max(0, cr - h + 1);
      const r1max = Math.min(size - h, cr);
      const c1min = Math.max(0, cc - w + 1);
      const c1max = Math.min(size - w, cc);

      for (let r1 = r1min; r1 <= r1max; r1++) {
        for (let c1 = c1min; c1 <= c1max; c1++) {
          const r2 = r1 + h - 1;
          const c2 = c1 + w - 1;

          // Check no other clue is inside this rectangle
          let conflict = false;
          for (let r = r1; r <= r2 && !conflict; r++) {
            for (let c = c1; c <= c2 && !conflict; c++) {
              if (otherClues.has(r * size + c)) conflict = true;
            }
          }
          if (!conflict) results.push({ r1, c1, r2, c2 });
        }
      }
    }
    return results;
  }

  /**
   * Check if a candidate rectangle conflicts with already-placed rectangles.
   * Returns true if any cell of rect is already occupied by another placed rect.
   */
  _conflicts(rect, placed) {
    const { r1, c1, r2, c2 } = rect;
    for (const p of placed) {
      if (p === null) continue;
      // Check overlap
      if (r1 <= p.r2 && r2 >= p.r1 && c1 <= p.c2 && c2 >= p.c1) return true;
    }
    return false;
  }

  /**
   * Constraint propagation: repeatedly prune candidate lists.
   * Returns { changed, contradiction } — does NOT mutate this.clues.
   *
   * @param {Array<Array<{r1,c1,r2,c2}>>} candidates  - mutable per-clue candidate lists
   * @param {Array<{r1,c1,r2,c2}|null>}   placed      - mutable placed rectangle per clue
   * @returns {{ contradiction: boolean }}
   */
  _propagate(candidates, placed) {
    let changed = true;
    while (changed) {
      changed = false;

      // Rule 1: clue with 1 candidate → place it
      for (let i = 0; i < this.clues.length; i++) {
        if (placed[i] !== null) continue;
        if (candidates[i].length === 0) return { contradiction: true };
        if (candidates[i].length === 1) {
          placed[i] = candidates[i][0];
          changed = true;
        }
      }

      // Rule 2: remove candidates that conflict with newly placed rects
      for (let i = 0; i < this.clues.length; i++) {
        if (placed[i] !== null) continue;
        const before = candidates[i].length;
        candidates[i] = candidates[i].filter(c => !this._conflicts(c, placed));
        if (candidates[i].length < before) changed = true;
        if (candidates[i].length === 0) return { contradiction: true };
      }
    }
    return { contradiction: false };
  }

  /**
   * Solve the puzzle. Returns up to `maxSolutions` solutions.
   * Each solution is an array of placed rectangles (index matches clues[i]).
   *
   * @param {number} maxSolutions
   * @returns {Array<Array<{r1,c1,r2,c2}>>}
   */
  solve(maxSolutions = 2) {
    // Initial candidates
    const initCandidates = this.clues.map((_, i) => this.getCandidates(i));
    const initPlaced = new Array(this.clues.length).fill(null);

    const solutions = [];
    this._backtrack(
      initCandidates.map(c => [...c]),
      [...initPlaced],
      solutions,
      maxSolutions
    );
    return solutions;
  }

  _backtrack(candidates, placed, solutions, maxSolutions) {
    if (solutions.length >= maxSolutions) return;

    // Propagate
    const { contradiction } = this._propagate(candidates, placed);
    if (contradiction) return;

    // Check if solved
    if (placed.every(p => p !== null)) {
      solutions.push([...placed]);
      return;
    }

    // Pick unplaced clue with fewest candidates (MRV)
    let minLen = Infinity, pick = -1;
    for (let i = 0; i < this.clues.length; i++) {
      if (placed[i] !== null) continue;
      if (candidates[i].length < minLen) {
        minLen = candidates[i].length;
        pick = i;
      }
    }
    if (pick === -1) return; // shouldn't happen

    // Branch on each candidate for the picked clue
    for (const rect of candidates[pick]) {
      if (solutions.length >= maxSolutions) return;

      const newPlaced = [...placed];
      newPlaced[pick] = rect;
      const newCandidates = candidates.map((c, i) =>
        i === pick ? [rect] : [...c]
      );

      this._backtrack(newCandidates, newPlaced, solutions, maxSolutions);
    }
  }

  /**
   * Convenience: returns true if the puzzle has exactly one solution.
   */
  isUnique() {
    return this.solve(2).length === 1;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined') module.exports = ShikakuSolver;
