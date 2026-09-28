// Every card of the horse race wears art from the 300 DEGEN NFT collection
// (policy 585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6). The
// images in public/cards put each degen on its suit colour (♠ navy, ♥ red,
// ♦ gold, ♣ green) so suits read at a glance; the figures are not altered.
// Swap a card by changing its DEGEN number here and building its image with
// scripts/card-art.cjs (--legend for degens with a painted scene).

export const DEGEN_COLLECTION_URL = "https://www.wayup.io/collection/585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6";

/** Jacks, queens and kings: the collection's named characters. Per suit (♠ ♥ ♦ ♣). */
const FACES: Record<number, { J: [number, string]; Q: [number, string]; K: [number, string] }> = {
  0: { J: [3, "Ephialtes"], Q: [5, "Snek"], K: [1, "Leonidas"] },
  1: { J: [30, "Maxi"], Q: [6, "Oracle"], K: [4, "Cock"] },
  2: { J: [23, "Tim Cheese"], Q: [9, "SUGR"], K: [2, "Xerxes"] },
  3: { J: [18, "Bull"], Q: [10, "Bull"], K: [7, "Gator"] },
};

/**
 * Number cards 10 … 2 by the degen's weapon: ♠ sword, ♥ shield, ♦ hammer,
 * ♣ spear; the rarest degens carry the highest numbers.
 */
const NUMBERS: Record<number, number[]> = {
  0: [14, 35, 40, 43, 50, 53, 68, 69, 78],
  1: [20, 24, 26, 32, 44, 47, 56, 63, 71],
  2: [12, 15, 21, 27, 28, 36, 41, 42, 48],
  3: [13, 31, 38, 46, 49, 57, 61, 65, 70],
};

/** The aces are the racehorses: four legendary degens, one per suit. */
const ACES: [number, string][] = [
  [11, "Bearded"],
  [8, "Bull"],
  [22, "SUGR"],
  [17, "Tim Cheese"],
];

const pad = (degen: number) => String(degen).padStart(3, "0");

export const aceArt = (suit: number) => {
  const [degen, name] = ACES[suit];
  return { src: `/cards/degen-${pad(degen)}.jpg`, alt: `DEGEN #${pad(degen)} ${name}` };
};

/** Art for any non-ace card (suit 0–3, rank "2" … "K"). */
export const cardArt = (suit: number, rank: string) => {
  if (rank === "J" || rank === "Q" || rank === "K") {
    const [degen, name] = FACES[suit][rank];
    return { src: `/cards/degen-${pad(degen)}.jpg`, alt: `DEGEN #${pad(degen)} ${name}`, face: true };
  }
  const degen = NUMBERS[suit][10 - Number(rank)];
  return { src: `/cards/degen-${pad(degen)}.jpg`, alt: `DEGEN #${pad(degen)}`, face: false };
};
