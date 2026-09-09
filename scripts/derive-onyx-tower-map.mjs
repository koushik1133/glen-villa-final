#!/usr/bin/env node
/**
 * Re-derive (and visually check) the Onyx floor map in
 * src/lib/showcase/onyx-tower-map.ts.
 *
 *   node scripts/derive-onyx-tower-map.mjs
 *   node scripts/derive-onyx-tower-map.mjs --check /tmp/onyx-floor-check.png
 *   node scripts/derive-onyx-tower-map.mjs public/showcase/onyx/tower-045.webp \
 *     --strip 700,860,60,790 --check /tmp/a45.png
 *
 * It takes the image as an optional first argument, so ANY angle of the tower
 * can be calibrated with it — that is what turns a turntable delivery into a
 * mechanical job: one run per render, paste the printed fit into a view
 * descriptor in src/lib/showcase/onyx-tower-views.ts, look at the check PNG.
 * Flags: --strip x0,x1,y0,y1 --floors N --refX --intervals --vanishX --vanishY
 * --leftX0 --leftSlope --rightX0 --rightSlope.
 *
 * The first form re-detects the façade slab lines, refits the quadratic and
 * prints the coefficients and residual. The second also renders the resulting
 * bands over the render with floor numbers drawn on — LOOK AT THAT IMAGE before
 * you trust the numbers. The mapping is only correct if the bottom band sits on
 * the lowest residential floor above the podium and the top band on the level
 * immediately under the crown.
 *
 * If the render is replaced, re-run this, copy the printed coefficients into
 * ONYX_TOWER_FIT, then re-check the façade edge lines by eye (they are the part
 * this script does NOT solve — see the module comment).
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- CLI ---------------- */

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

/** Any render can be measured, not just tower.webp — that is what makes a turntable a mechanical job. */
const IMAGE = path.resolve(ROOT, positional[0] ?? "public/showcase/onyx/tower.webp");
const FLOORS = Number(flag("--floors", 35));

/**
 * The sampling strip: the wide façade, in the image's own pixel space. The
 * default is calibrated for tower.webp (1600x960). For a new angle the façade
 * moves, so pass --strip x0,x1,y0,y1 after looking at the render; the script
 * scales the default proportionally as a first guess when the image is a
 * different size, which is usually close enough to iterate from.
 */
const DEFAULT_STRIP = { x0: 640, x1: 800, y0: 60, y1: 790, w: 1600, h: 960 };
function parseStrip(meta) {
  const raw = flag("--strip", null);
  if (raw) {
    const [x0, x1, y0, y1] = raw.split(",").map(Number);
    return { x0, x1, y0, y1 };
  }
  const sx = meta.width / DEFAULT_STRIP.w;
  const sy = meta.height / DEFAULT_STRIP.h;
  return {
    x0: Math.round(DEFAULT_STRIP.x0 * sx),
    x1: Math.round(DEFAULT_STRIP.x1 * sx),
    y0: Math.round(DEFAULT_STRIP.y0 * sy),
    y1: Math.round(DEFAULT_STRIP.y1 * sy),
  };
}

const META = await sharp(IMAGE).metadata();
const STRIP = parseStrip(META);

/* ---------------- 1. detect horizontal slab / railing lines ---------------- */

async function detectLines() {
  const { x0, x1, y0, y1 } = STRIP;
  const w = x1 - x0;
  const h = y1 - y0;
  const { data } = await sharp(IMAGE)
    .extract({ left: x0, top: y0, width: w, height: h })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const g = (x, y) => data[y * w + x];

  const prof = new Float64Array(h);
  for (let y = 1; y < h - 1; y++) {
    let s = 0;
    for (let x = 1; x < w - 1; x++) {
      s += Math.abs(
        g(x - 1, y - 1) + 2 * g(x, y - 1) + g(x + 1, y - 1) -
          (g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1)),
      );
    }
    prof[y] = s / (w - 2);
  }
  const sm = Array.from(prof, (_, i) =>
    (prof[Math.max(0, i - 1)] + prof[i] + prof[Math.min(h - 1, i + 1)]) / 3,
  );
  // Rolling median baseline: the façade's contrast changes a lot top to bottom.
  const base = sm.map((_, i) => {
    const a = sm.slice(Math.max(0, i - 25), Math.min(h, i + 26)).sort((p, q) => p - q);
    return a[a.length >> 1];
  });

  const peaks = [];
  for (let y = 2; y < h - 2; y++) {
    if (sm[y] > base[y] * 1.05 && sm[y] >= sm[y - 1] && sm[y] >= sm[y + 1] && sm[y] > sm[y - 2] && sm[y] > sm[y + 2]) {
      const den = sm[y - 1] - 2 * sm[y] + sm[y + 1];
      const d = den ? (sm[y - 1] - sm[y + 1]) / (2 * den) : 0;
      peaks.push({ y: y0 + y + (Math.abs(d) < 1 ? d : 0), v: sm[y] - base[y] });
    }
  }
  // Every floor prints two lines ~9 px apart (slab edge + balcony railing).
  // Merging at 3.5 px keeps one peak per printed line; the ~18 px floor pitch
  // then falls out of the fit below.
  const merged = [];
  for (const p of peaks) {
    const last = merged[merged.length - 1];
    if (last && p.y - last.y < 3.5) {
      if (p.v > last.v) merged[merged.length - 1] = p;
    } else merged.push(p);
  }
  return merged.map((p) => p.y);
}

/* ---------------- 2. fit y(k) = a + b k + c k^2 ---------------- */

function polyfit(ks, ys, deg = 2) {
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let t = 0; t < ks.length; t++) {
    const p = Array.from({ length: m }, (_, i) => ks[t] ** i);
    for (let i = 0; i < m; i++) {
      b[i] += p[i] * ys[t];
      for (let j = 0; j < m; j++) A[i][j] += p[i] * p[j];
    }
  }
  for (let i = 0; i < m; i++) {
    let piv = i;
    for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = 0; r < m; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < m; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

const evalPoly = (c, k) => c.reduce((s, v, i) => s + v * k ** i, 0);

/** Longest run of peaks whose spacing stays in the plausible floor-pitch band. */
function seedRun(peaks) {
  let best = [];
  let run = [peaks[0]];
  for (let i = 1; i < peaks.length; i++) {
    const d = peaks[i] - peaks[i - 1];
    if (d > 15 && d < 22) run.push(peaks[i]);
    else {
      if (run.length > best.length) best = run;
      run = [peaks[i]];
    }
  }
  return run.length > best.length ? run : best;
}

function fitLines(peaks) {
  const seed = seedRun(peaks);
  let coeffs = polyfit(seed.map((_, i) => i), seed, 2);
  let ks = [];
  let ys = [];
  for (let iter = 0; iter < 6; iter++) {
    ks = [];
    ys = [];
    for (let k = 0; k < FLOORS; k++) {
      const p = evalPoly(coeffs, k);
      let best = null;
      let bd = Infinity;
      for (const y of peaks) {
        const d = Math.abs(y - p);
        if (d < bd) {
          bd = d;
          best = y;
        }
      }
      if (bd <= 4.5) {
        ks.push(k);
        ys.push(best);
      }
    }
    coeffs = polyfit(ks, ys, 2);
  }
  const res = ks.map((k, i) => ys[i] - evalPoly(coeffs, k));
  return {
    coeffs,
    matched: ks.length,
    maxResidual: Math.max(...res.map(Math.abs)),
    rms: Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length),
  };
}

/* ---------------- 3. render the check image ---------------- */

async function renderCheck(out, fit) {
  const mod = await import(
    path.join(ROOT, ".test-build/src/lib/showcase/onyx-tower-map.js")
  ).catch(() => ({}));
  if (!mod.buildOnyxFloorBands) {
    console.error(
      "check: compile the module first — `npx tsc -p tsconfig.test.json` — then re-run with --check.",
    );
    return;
  }
  const W = META.width;
  const H = META.height;
  // Bands are always rebuilt from the fit we just measured for THIS image, so
  // the check PNG shows the candidate calibration and not the committed one.
  const ONYX_FLOOR_BANDS = mod.buildOnyxFloorBands(fit, { src: IMAGE, width: W, height: H }, FLOORS);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 100 100" preserveAspectRatio="none">`;
  // Text has to live in a second, unscaled overlay or preserveAspectRatio="none" shears it.
  let labels = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  for (const band of ONYX_FLOOR_BANDS) {
    const hue = (band.floor * 10) % 360;
    svg += `<polygon points="${band.polygon}" fill="hsl(${hue} 90% 55% / 0.28)" stroke="hsl(${hue} 95% 60%)" stroke-width="0.05"/>`;
    const rx = (band.points[1].x / 100) * W + 6;
    const ry = ((band.points[1].y + band.points[2].y) / 200) * H + 4;
    const lx = (band.points[0].x / 100) * W - 22;
    const ly = ((band.points[0].y + band.points[3].y) / 200) * H + 4;
    labels += `<text x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" font-size="11" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${band.floor}</text>`;
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10" fill="#ff0" stroke="#000" stroke-width="2.5" paint-order="stroke">${band.floor}</text>`;
  }
  svg += "</svg>";
  labels += "</svg>";
  await sharp(IMAGE)
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
      { input: Buffer.from(labels), top: 0, left: 0 },
    ])
    .png()
    .toFile(out);
  console.log("check image:", out);
}

/* ---------------- main ---------------- */

console.log("image:", path.relative(ROOT, IMAGE), `${META.width}x${META.height}`);
console.log(`strip: x ${STRIP.x0}..${STRIP.x1}  y ${STRIP.y0}..${STRIP.y1}  ·  floors ${FLOORS}`);
const peaks = await detectLines();
const fit = fitLines(peaks);
console.log(`detected ${peaks.length} edge peaks in x ${STRIP.x0}..${STRIP.x1}`);
console.log(
  `fit  a=${fit.coeffs[0].toFixed(6)}  b=${fit.coeffs[1].toFixed(6)}  c=${fit.coeffs[2].toFixed(6)}`,
);
console.log(
  `matched ${fit.matched} lines · max residual ${fit.maxResidual.toFixed(2)} px · RMS ${fit.rms.toFixed(2)} px`,
);
console.log(
  `top line y=${evalPoly(fit.coeffs, 0).toFixed(1)} · bottom line y=${evalPoly(fit.coeffs, 34).toFixed(1)} · pitch ${(evalPoly(fit.coeffs, 1) - evalPoly(fit.coeffs, 0)).toFixed(2)} → ${(evalPoly(fit.coeffs, 34) - evalPoly(fit.coeffs, 33)).toFixed(2)} px`,
);

/**
 * The candidate calibration for this image. The quadratic and the interval
 * count come out of the fit above; the four façade-edge numbers and the
 * vanishing point do NOT — they are eyeballed per angle against the check PNG
 * and can be overridden from the command line while you converge.
 */
const candidateFit = {
  a: fit.coeffs[0],
  b: fit.coeffs[1],
  c: fit.coeffs[2],
  refX: Number(flag("--refX", ((STRIP.x0 + STRIP.x1) / 2).toFixed(0))),
  detectedIntervals: Number(flag("--intervals", FLOORS - 1)),
  vanishX: Number(flag("--vanishX", 6490)),
  vanishY: Number(flag("--vanishY", -60)),
  leftX0: Number(flag("--leftX0", 620)),
  leftSlope: Number(flag("--leftSlope", 0.0333)),
  rightX0: Number(flag("--rightX0", 808)),
  rightSlope: Number(flag("--rightSlope", 0.015)),
  maxResidualPx: +fit.maxResidual.toFixed(2),
  rmsResidualPx: +fit.rms.toFixed(2),
};

console.log("\ncandidate fit — paste into the view descriptor in src/lib/showcase/onyx-tower-views.ts:");
console.log(JSON.stringify(candidateFit, null, 2));
console.log(
  "\nThe edge and vanishing-point numbers above are DEFAULTS copied from angle 0. " +
    "Look at the check PNG and re-run with --leftX0/--leftSlope/--rightX0/--rightSlope/--vanishX/--vanishY until the bands hug this façade.",
);

const ci = argv.indexOf("--check");
if (ci !== -1) await renderCheck(path.resolve(ROOT, argv[ci + 1] ?? "onyx-floor-check.png"), candidateFit);
