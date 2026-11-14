// The fossil on the home page: a pixel skeleton split into one bone group per checked sentence, head to tail.

type Cell = [number, number];

function line(cells: Cell[], x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const spineY = (x: number) => (x <= 22 ? Math.round(24 - ((x - 1) * 8) / 21) : Math.round(16 - ((x - 22) * 4) / 18));

/** Skull, neck, spine, ribs, arm, legs, tail: the order the bones are uncovered. */
function skeletonCells(): Cell[] {
  const skull: Cell[] = [], neck: Cell[] = [], spine: Cell[] = [], ribs: Cell[] = [], arm: Cell[] = [], legs: Cell[] = [], tail: Cell[] = [];
  const rows: Record<number, [number, number]> = { 2: [49, 56], 3: [47, 59], 4: [46, 61], 5: [46, 62], 6: [46, 62], 7: [47, 62], 9: [48, 61], 10: [49, 60], 11: [51, 57] };
  const holes = new Set(["52,4", "53,4", "52,5", "53,5", "58,5", "59,5"]);
  for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) if (!holes.has(`${x},${y}`)) skull.push([x, Number(y)]);
  [48, 49, 53, 55, 57, 59, 61].forEach((x) => skull.push([x, 8]));
  line(neck, 40, 12, 47, 8); line(neck, 40, 13, 47, 9);
  for (let x = 22; x <= 40; x++) { if (x === 31) continue; spine.push([x, spineY(x)]); if (x % 3 === 0) spine.push([x, spineY(x) - 1]); }
  [25, 27, 29, 31, 33, 35, 37].forEach((rx) => {
    const top = spineY(rx) + 1, len = rx >= 29 && rx <= 33 ? 8 : 6;
    for (let i = 0; i < len; i++) ribs.push([i > len / 2 ? rx - 1 : rx, top + i]);
  });
  line(arm, 39, 17, 42, 20); line(arm, 42, 20, 44, 20); arm.push([45, 19], [45, 21]);
  for (let hx = 19; hx <= 25; hx++) for (let hy = 16; hy <= 18; hy++) legs.push([hx, hy]);
  line(legs, 24, 19, 27, 27); line(legs, 27, 27, 25, 34); for (let f = 23; f <= 30; f++) legs.push([f, 35]);
  line(legs, 19, 19, 21, 27); line(legs, 21, 27, 18, 34); for (let f = 16; f <= 22; f++) legs.push([f, 35]);
  for (let tx = 21; tx >= 1; tx--) { tail.push([tx, spineY(tx)]); if (tx % 3 === 0 && tx > 4) tail.push([tx, spineY(tx) - 1]); }
  const seen = new Set<string>();
  return [...skull, ...neck, ...spine, ...ribs, ...arm, ...legs, ...tail].filter(([x, y]) => (seen.has(`${x},${y}`) ? false : (seen.add(`${x},${y}`), true)));
}

const toPath = (cells: Cell[]) => cells.map(([x, y]) => `M${x} ${y}h.82v.82h-.82z`).join("");

export interface BoneGroup { path: string; cx: number; cy: number }

/** Split the skeleton into n contiguous groups. cx/cy are in skeleton cells (multiply by the drawing scale). */
export function boneGroups(n: number): { groups: BoneGroup[]; ghost: string } {
  const cells = skeletonCells();
  const count = Math.max(1, n);
  const groups: BoneGroup[] = [];
  for (let i = 0; i < count; i++) {
    const part = cells.slice(Math.floor((i * cells.length) / count), Math.floor(((i + 1) * cells.length) / count));
    const cx = part.reduce((s, c) => s + c[0], 0) / Math.max(1, part.length);
    const cy = part.reduce((s, c) => s + c[1], 0) / Math.max(1, part.length);
    // the marker sits on the bone cell nearest the group's centre
    const near = part.reduce((best, c) => ((c[0] - cx) ** 2 + (c[1] - cy) ** 2 < (best[0] - cx) ** 2 + (best[1] - cy) ** 2 ? c : best), part[0] ?? [0, 0]);
    groups.push({ path: toPath(part), cx: near[0] + 0.4, cy: near[1] + 0.4 });
  }
  return { groups, ghost: toPath(cells) };
}
