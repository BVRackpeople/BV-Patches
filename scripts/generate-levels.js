'use strict';
/**
 * Generate pre-made levels for all 5 difficulties.
 * Uses worker_threads so each puzzle has a timeout — avoiding rare hangs on
 * larger grids. Run with: node scripts/generate-levels.js
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

// ── Worker mode: generate a single puzzle ─────────────────────────────────────
if (!isMainThread) {
  if (typeof performance === 'undefined') {
    global.performance = require('perf_hooks').performance;
  }
  // Expose as globals (generator.js uses ShikakuSolver as a global name)
  global.ShikakuSolver   = require(workerData.solverPath);
  global.PuzzleGenerator = require(workerData.generatorPath);

  const puzzle = new global.PuzzleGenerator(workerData.size).generate();
  parentPort.postMessage({ clues: puzzle.clues });
  return;
}

// ── Main mode ─────────────────────────────────────────────────────────────────
const SOLVER_PATH    = path.resolve(__dirname, '../js/solver.js');
const GENERATOR_PATH = path.resolve(__dirname, '../js/generator.js');

// Counts and timeout per size
const CONFIG = {
  5: { count: 100, timeout: 5000  },
  6: { count: 100, timeout: 5000  },
  7: { count: 100, timeout: 8000  },
  8: { count: 100, timeout: 15000 },
  9: { count: 100, timeout: 60000 },
};

function generateOne(size, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: {
        size,
        solverPath:    SOLVER_PATH,
        generatorPath: GENERATOR_PATH,
      },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`timeout after ${timeoutMs}ms for size ${size}`));
    }, timeoutMs);

    worker.on('message', (puzzle) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(puzzle);
    });

    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const result  = {};
  let timeouts  = 0;

  for (const size of [5, 6, 7, 8, 9]) {
    const { count, timeout: timeoutMs } = CONFIG[size];
    result[size] = [];
    process.stdout.write(`${size}×${size}  0/${count}`);
    const t0 = Date.now();
    let attempts = 0;

    while (result[size].length < count) {
      attempts++;
      try {
        const puzzle = await generateOne(size, timeoutMs);
        result[size].push(puzzle);
        process.stdout.write(`\r${size}×${size}  ${result[size].length}/${count}`);
      } catch {
        timeouts++;
        // Retry silently — timeouts are normal for unlucky partitions
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const retries = attempts - count;
    console.log(
      `\r${size}×${size}  ${count}/${count}  ✓  (${elapsed}s${retries ? ', ' + retries + ' retries' : ''})`
    );
  }

  const total   = Object.values(result).reduce((s, arr) => s + arr.length, 0);
  const outPath = path.join(__dirname, '..', 'js', 'levels.js');
  fs.writeFileSync(
    outPath,
    `// Auto-generated — run: node scripts/generate-levels.js\nconst LEVELS = ${JSON.stringify(result)};\n`
  );

  if (timeouts) console.log(`(${timeouts} timed-out attempts retried)`);
  console.log(`\nWrote ${total} puzzles to js/levels.js`);
}

main().catch(console.error);
