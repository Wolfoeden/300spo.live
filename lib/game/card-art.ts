// Face cards of the horse race wear art from the 300 DEGEN NFT collection
// (policy 585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6). The
// images live in public/cards as 320 px copies of the IPFS originals.
// Swap a card by changing its DEGEN number here and adding the image.

export const DEGEN_COLLECTION_URL = "https://www.wayup.io/collection/585f70537a92ac23c87c913fba12cb8251c07032ba0a44c851fd3cd6";

type Face = { degen: number; name: string };

/** Per suit (♠ ♥ ♦ ♣): jack, queen, king. */
const FACES: Record<number, { J: Face; Q: Face; K: Face }> = {
  0: { J: { degen: 3, name: "Ephialtes" }, Q: { degen: 5, name: "Snek" }, K: { degen: 1, name: "Leonidas" } },
  1: { J: { degen: 30, name: "Maxi" }, Q: { degen: 6, name: "Oracle" }, K: { degen: 4, name: "Cock" } },
  2: { J: { degen: 23, name: "Tim Cheese" }, Q: { degen: 9, name: "SUGR" }, K: { degen: 2, name: "Xerxes" } },
  3: { J: { degen: 18, name: "Bull" }, Q: { degen: 10, name: "Bull" }, K: { degen: 7, name: "Gator" } },
};

/** Art for a face card, or null for number cards. */
export const faceArt = (suit: number, rank: string) => {
  if (rank !== "J" && rank !== "Q" && rank !== "K") return null;
  const face = FACES[suit][rank];
  return { src: `/cards/degen-${String(face.degen).padStart(3, "0")}.jpg`, alt: `DEGEN #${String(face.degen).padStart(3, "0")} ${face.name}` };
};
