// Одно зерно на прогон: GG_SEED=123 npm test повторяет тот же случайный набор. Зерно печатается.
'use strict';
const seed = Number(process.env.GG_SEED) || 20261101;
const runs = (n) => Math.max(1, Math.round(n * (Number(process.env.GG_RUNS_SCALE) || 1)));
const opts = (n) => ({ seed, numRuns: runs(n) });
if (!process.env.GG_SEED_SHOWN) { process.env.GG_SEED_SHOWN = '1'; console.log('# seed ' + seed); }
module.exports = { seed, runs, opts };
