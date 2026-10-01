// Every card of the horse race wears art from the 300 DEGEN NFT collection
// (policy 585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6). Each degen
// sits on the suit colour it wears most: a blue skirt or the blue bull mask on
// ♠ blue, a red skirt on ♥ red, a gold skirt, gold helmet or cheese hat on
// ♦ gold, black and steel on ♣ grey-black. The deck holds rares and commons
// only; the legendaries are left out, except the four painted 1/1s that race
// as the aces. The figures are not altered.
// Swap a card by changing its DEGEN number here and building its image with
// scripts/card-art.cjs (--legend for degens with a painted scene).

export const DEGEN_COLLECTION_URL = "https://www.wayup.io/collection/585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6";

/** Jacks, queens and kings: the rares whose colour is clearest. Per suit (♠ ♥ ♦ ♣). */
const FACES: Record<number, { J: [number, string]; Q: [number, string]; K: [number, string] }> = {
  0: { J: [37, "Long Blonde"], Q: [117, "Bull"], K: [111, "Bull"] },
  1: { J: [106, "Short Black"], Q: [102, "Short Blonde"], K: [40, "Black"] },
  2: { J: [94, "Blonde Beard"], Q: [51, "SUGR"], K: [53, "SUGR"] },
  3: { J: [78, "Maxi"], Q: [74, "Maxi"], K: [91, "Full Faced Black"] },
};

/** Number cards 10 … 2: the clearer the colour, the higher the number. */
const NUMBERS: Record<number, number[]> = {
  0: [38, 124, 126, 135, 147, 165, 182, 183, 193],
  1: [203, 272, 161, 200, 138, 149, 180, 186, 222],
  2: [133, 140, 281, 143, 245, 197, 208, 246, 152],
  3: [174, 261, 164, 184, 239, 137, 181, 212, 228],
};

/**
 * The aces are the racehorses: the collection's painted 1/1s, one per suit.
 * The Oracle's card is ivory rather than gold, Ephialtes' grey-black.
 */
const ACES: [number, string][] = [
  [5, "Snek Warrior"],
  [1, "Leonidas"],
  [6, "Oracle"],
  [3, "Ephialtes"],
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
