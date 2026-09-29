// Card horse race: the four aces race past seven face-up track cards.
//
// Deck: the 48 cards without aces, card c = suit ⌊c/12⌋ (♠ ♥ ♦ ♣), rank c mod 12
// (2 … K). The shuffle, the race and the odds table are mirrored exactly by
// game.race_deck(), game.race_run() and game.race_odds in the database.
import { hmacShuffle } from "./fair";

export const SUITS = ["Spades", "Hearts", "Diamonds", "Clubs"] as const;
export const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"] as const;
export const TRACK_LENGTH = 7;
/** An ace wins on reaching this step, one past the last track card. */
export const FINISH = TRACK_LENGTH + 1;
export const DECK_SIZE = 48;
/** Payouts are capped at 100× for long shots. */
export const MAX_ODDS_BPS = 1_000_000;

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const cardSuit = (card: number) => Math.floor(card / 12);
export const cardRank = (card: number) => RANKS[card % 12];
/**
 * Four-colour deck, matching the card backgrounds in public/cards:
 * ♠ navy, ♥ red, ♦ gold, ♣ green. Text tones for dark surfaces.
 */
export const SUIT_COLORS = ["#8fb1ff", "#ff6b6b", "#f5c451", "#4fd08a"] as const;

/**
 * Fisher–Yates shuffle of the 48 cards. Random numbers are big-endian 32-bit
 * words from HMAC-SHA256(serverSeed, "<clientSeed>:<nonce>:race:<block>"),
 * block = 0, 1, …; a word ≥ the largest multiple of n below 2^32 is skipped,
 * so every position is equally likely.
 */
export const raceDeck = (serverSeedHex: string, clientSeed: string, nonce: number) => hmacShuffle(serverSeedHex, clientSeed, nonce, "race", DECK_SIZE);

export type RaceEvent = { kind: "draw"; card: number; suit: number } | { kind: "setback"; row: number; suit: number };

/**
 * Runs the race on a shuffled deck: the first seven cards are the track, the
 * rest are turned one by one. Each turned card moves the ace of its suit one
 * step. When every ace has reached track card k (in order 1 … 7), that card
 * sends the ace of its own suit one step back. The first ace to reach step 8 wins.
 */
export const runRace = (deck: number[]) => {
  const track = deck.slice(0, TRACK_LENGTH);
  const positions = [0, 0, 0, 0];
  const events: RaceEvent[] = [];
  let reached = 0;
  for (const card of deck.slice(TRACK_LENGTH)) {
    const suit = cardSuit(card);
    positions[suit] += 1;
    events.push({ kind: "draw", card, suit });
    if (positions[suit] === FINISH) return { track, winner: suit, events, draws: events.filter((event) => event.kind === "draw").length };
    while (reached < TRACK_LENGTH && Math.min(...positions) >= reached + 1) {
      const back = cardSuit(track[reached]);
      positions[back] -= 1;
      events.push({ kind: "setback", row: reached + 1, suit: back });
      reached += 1;
    }
  }
  throw new Error("The race did not finish");
};

/** Replays race events and returns the positions after the first `count` of them. */
export const positionsAfter = (events: RaceEvent[], count: number) => {
  const positions = [0, 0, 0, 0];
  for (const event of events.slice(0, count)) positions[event.suit] += event.kind === "draw" ? 1 : -1;
  return positions;
};

/**
 * Relabels the track's suits in order of first appearance (absent suits get
 * the remaining labels), so tracks that only differ by suit names share one
 * odds entry: 4^7 tracks → 715 patterns.
 */
export const trackPattern = (trackSuits: number[]) => {
  const labelOf = [-1, -1, -1, -1];
  let next = 0;
  const pattern = trackSuits
    .map((suit) => {
      if (labelOf[suit] < 0) labelOf[suit] = next++;
      return labelOf[suit];
    })
    .join("");
  for (let suit = 0; suit < 4; suit += 1) if (labelOf[suit] < 0) labelOf[suit] = next++;
  return { pattern, labelOf };
};

/**
 * Exact probability of each suit winning, given the track, over all orders of
 * the 41 remaining cards. State: cards drawn per suit and track cards reached.
 */
export const winProbabilities = (trackSuits: number[]) => {
  const remaining = [0, 1, 2, 3].map((suit) => 12 - trackSuits.filter((value) => value === suit).length);
  // backs[k][suit] = setbacks of `suit` once the first k track cards were reached
  const backs = [[0, 0, 0, 0]];
  for (const suit of trackSuits) backs.push(backs[backs.length - 1].map((value, index) => value + (index === suit ? 1 : 0)));
  const memo = new Map<number, number[]>();

  const solve = (drawn: number[], reached: number): number[] => {
    const key = (((drawn[0] * 16 + drawn[1]) * 16 + drawn[2]) * 16 + drawn[3]) * 8 + reached;
    const cached = memo.get(key);
    if (cached) return cached;
    const left = remaining.map((count, suit) => count - drawn[suit]);
    const total = left.reduce((sum, count) => sum + count, 0);
    const result = [0, 0, 0, 0];
    for (let suit = 0; suit < 4; suit += 1) {
      if (left[suit] === 0) continue;
      const chance = left[suit] / total;
      const next = drawn.map((count, index) => count + (index === suit ? 1 : 0));
      const positions = next.map((count, index) => count - backs[reached][index]);
      if (positions[suit] === FINISH) {
        result[suit] += chance;
        continue;
      }
      let nextReached = reached;
      while (nextReached < TRACK_LENGTH && Math.min(...positions) >= nextReached + 1) {
        positions[trackSuits[nextReached]] -= 1;
        nextReached += 1;
      }
      const sub = solve(next, nextReached);
      for (let index = 0; index < 4; index += 1) result[index] += chance * sub[index];
    }
    memo.set(key, result);
    return result;
  };

  return solve([0, 0, 0, 0], 0);
};

/** Fair payout for a win probability, rounded down to a basis point and capped. 0 = cannot win. */
export const oddsBps = (probability: number) =>
  // + 1e-6 keeps float noise from pushing exact values (1/3 → 30000) one basis point down.
  probability <= 1e-12 ? 0 : Math.min(MAX_ODDS_BPS, Math.floor(10000 / probability + 1e-6));

/** Every track pattern (restricted-growth strings of length 7 over 4 labels). */
export const allPatterns = () => {
  const patterns: string[] = [];
  const walk = (prefix: number[], max: number) => {
    if (prefix.length === TRACK_LENGTH) return void patterns.push(prefix.join(""));
    for (let label = 0; label <= Math.min(max + 1, 3); label += 1) walk([...prefix, label], Math.max(max, label));
  };
  walk([], -1);
  return patterns;
};

/** Odds per label for a pattern, as stored in game.race_odds. */
export const patternOdds = (pattern: string) => winProbabilities([...pattern].map(Number)).map(oddsBps);

/** Odds per suit for a track (browser-side mirror of game.race_odds_for). */
export const trackOdds = (track: number[]) => {
  const { pattern, labelOf } = trackPattern(track.map(cardSuit));
  const odds = patternOdds(pattern);
  return labelOf.map((label) => odds[label]);
};
