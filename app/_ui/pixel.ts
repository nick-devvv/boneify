// Pixel art drawn from text grids: each letter is one colour, "." is empty. One SVG path per colour, crisp edges.

export type PixelPaths = Record<string, string>;

export function pix(rows: string[]): PixelPaths {
  const out: PixelPaths = {};
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === ".") continue;
      out[c] = (out[c] || "") + `M${x} ${y}h1v1h-1z`;
    }
  });
  return out;
}

// Rex, the pixel T-rex (22 x 20). d = outline, g = green, l = belly, w = eye white, p = the receipt he holds.
export const REX = [
  "...........dddddddd...", "..........dggggggggd..", ".........dggggggggggd.", ".........dgggggwwdggd.", ".........dgggggwddggd.",
  ".........dggggggggggd.", ".........dggggggddddd.", ".........dgggggdwdwd..", ".........dgggggddddd..", "..d......dggggggd.....",
  "..dd....dgggggggd.....", "..dgd..dggggggggddppp.", "...dgddgggggggggdgdpp.", "....dggglllgggggdddpp.", ".....dgglllggggd...pp.",
  "......dgglllgggd......", ".......dggdddggd......", ".......dgd...dgd......", "......ddgd..ddgd......", "......dddd..dddd......",
];
const withRows = (base: string[], edits: Record<number, string>) => base.map((r, i) => edits[i] ?? r);
export const REX_SIDE = withRows(REX, { 3: ".........dgggggdddggd.", 4: ".........dgggggdwwggd." });
export const REX_HAPPY = withRows(REX, { 3: ".........dggggdgdgggd.", 4: ".........dgggdgggdggd." });
export const REX_CHOMP = withRows(REX, { 7: ".........dgggggdddddd.", 8: ".........dgggggd......" });
const WALK_LEGS = [".......dggdddggd......", "......dgd.....dgd.....", ".....ddgd.....ddgd....", ".....dddd.....dddd...."];
export const walking = (rows: string[]) => rows.slice(0, 16).concat(WALK_LEGS);

export const SAURO = [
  "............dd..", "...........dssd.", "...........dsd..", "..........dsd...", ".........dsd....", "..dddddddsd.....",
  ".dsssssssssd....", "dsssssssssssd...", ".dsssssssssd....", "..dsd.dsd.dsd...", "..dd..dd..dd....",
];
export const TRILO = ["..ddddd..", ".dtttttd.", "dtdtttdtd", ".dtttttd.", "dtdtttdtd", ".dtttttd.", "dtdtttdtd", ".dtttttd.", "..ddddd.."];
export const BONE = [".dd.......dd.", "daadddddddaad", ".daaaaaaaaad.", "daadddddddaad", ".dd.......dd."];
export const CRACK = [".dd.......dd.", "daadddrdddaad", ".daaaarraaad.", "daaddddrddaad", ".dd.......dd."];
export const PAGE = ["dddddddd..", "dppppppdd.", "dppppppdpd", "dpkkkkpddd", "dppppppppd", "dpkkkkkkpd", "dppppppppd", "dpkkkkkppd", "dppppppppd", "dpkkkkkkpd", "dppppppppd", "dddddddddd"];
export const PICK = [".ddddddd.", "dkkkkkkkd", "dkd.w.dkd", "dd..w..dd", "....w....", "....w....", "....w....", "....w....", "....w...."];
