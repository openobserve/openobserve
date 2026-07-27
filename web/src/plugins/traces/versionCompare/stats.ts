// stats.ts (part 1 — proportions + classifier)
import { CI_LEVEL } from "./constants";

export interface DiffCI {
  delta: number;
  lower: number;
  upper: number;
  straddlesZero: boolean;
}

// z for a two-sided (1-level) tail. 0.90 → 1.6449.
function zFor(level: number): number {
  // rational approximation (Acklam) of the inverse normal CDF at (1+level)/2
  const p = (1 + level) / 2;
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -7.78489400243029e-3, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878,
  ];
  const d = [7.78469570904146e-3, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425,
    phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

// Single-proportion Wilson score interval [lo, hi].
function wilson(x: number, n: number, z: number): [number, number] {
  if (n === 0) return [0, 1];
  const phat = x / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return [(centre - margin) / denom, (centre + margin) / denom];
}

// Newcombe method for the difference p_a - p_b.
export function proportionDiffCI(
  errA: number,
  nA: number,
  errB: number,
  nB: number,
  level = CI_LEVEL,
): DiffCI {
  const z = zFor(level);
  const [l1, u1] = wilson(errA, nA, z);
  const [l2, u2] = wilson(errB, nB, z);
  const pa = nA ? errA / nA : 0;
  const pb = nB ? errB / nB : 0;
  const delta = pa - pb;
  const lower = delta - Math.sqrt((pa - l1) ** 2 + (u2 - pb) ** 2);
  const upper = delta + Math.sqrt((u1 - pa) ** 2 + (pb - l2) ** 2);
  return { delta, lower, upper, straddlesZero: lower <= 0 && upper >= 0 };
}

export type MetricDir = "up-worse" | "neutral";
export type Verdict = "higher" | "lower" | "nochange" | "insufficient";

// The verdict describes the NEWER version B relative to the baseline A (the view
// is framed "from A to B"). The CI delta is oriented A − B, so `ci.lower > 0`
// means A > B — i.e. B is LOWER than A → verdict "lower". `ci.upper < 0` means
// A < B → B is HIGHER → "higher". (Returning "higher" for A>B, as before, labelled
// a latency/cost regression as an improvement.)
export function classifyVerdict(ci: DiffCI, dir: MetricDir, enoughSample: boolean): Verdict {
  if (!enoughSample) return "insufficient";
  if (dir === "neutral") return "nochange";
  if (ci.straddlesZero) return "nochange";
  return ci.lower > 0 ? "lower" : "higher";
}

// stats.ts (part 2 — percentile/mean/bootstrap)
export function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = q * (s.length - 1);
  const lo = Math.floor(idx),
    hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export type Estimator = (xs: number[]) => number;

// deterministic LCG so tests are reproducible under a seed
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

function resampleEstimate(xs: number[], est: Estimator, rnd: () => number): number {
  const n = xs.length;
  const r: number[] = new Array(n);
  for (let i = 0; i < n; i++) r[i] = xs[(rnd() * n) | 0];
  return est(r);
}

export function bootstrapDiffCI(
  sampleA: number[],
  sampleB: number[],
  est: Estimator,
  iters: number,
  level: number,
  seed: number,
): DiffCI {
  const rnd = lcg(seed);
  const diffs: number[] = new Array(iters);
  for (let i = 0; i < iters; i++)
    diffs[i] = resampleEstimate(sampleA, est, rnd) - resampleEstimate(sampleB, est, rnd);
  diffs.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const lower = percentile(diffs, alpha);
  const upper = percentile(diffs, 1 - alpha);
  const delta = est(sampleA) - est(sampleB);
  return { delta, lower, upper, straddlesZero: lower <= 0 && upper >= 0 };
}
