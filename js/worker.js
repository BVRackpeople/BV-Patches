// Puzzle generation runs here, off the main thread.
importScripts('solver.js', 'generator.js');

self.onmessage = function (e) {
  const { size } = e.data;
  const puzzle = new PuzzleGenerator(size).generate();
  self.postMessage(puzzle);
};
