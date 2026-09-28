// What each game's outcome indices mean. The database only knows numbers;
// index i here is outcome i in game.play() / game.play_race().
import { SUITS } from "./card-race";

export type GameId = "coin-flip" | "card-race" | "horse-race" | "xerxes-vs-robot";

/** Retired games: kept for labels in old rounds, never offered again. */
const RETIRED = new Set<string>(["horse-race"]);

export const HORSES = [
  { name: "Thermopylae", color: "#e9b44c" },
  { name: "Sparta", color: "#e5484d" },
  { name: "Persepolis", color: "#7c66dc" },
  { name: "Immortal", color: "#30a46c" },
  { name: "Cardano", color: "#3e63dd" },
] as const;

export const GAME_COPY: Record<GameId, { title: string; tagline: string; choices: string[] }> = {
  "coin-flip": { title: "Coin flip", tagline: "Xerxes or 300? Call the side.", choices: ["Xerxes", "300"] },
  "card-race": {
    title: "Horse race",
    tagline: "Four aces race past seven face-up cards. Every turned card moves its ace; when all aces reach a track card, that card's ace steps back.",
    choices: [...SUITS],
  },
  "horse-race": { title: "Horse race (classic)", tagline: "Five horses, one winner. Pick it.", choices: HORSES.map((horse) => horse.name) },
  "xerxes-vs-robot": { title: "Xerxes vs AI robot", tagline: "The god-king against the machine. Who stands?", choices: ["Xerxes", "AI robot"] },
};

export const isKnownGame = (id: string): id is GameId => id in GAME_COPY;

/** Tiles of the /play lobby. `game` links a live tile to its game; the rest are announced. */
export type LobbyTile = { slug: string; title: string; tagline: string; badge: string; game?: GameId };

export const LOBBY_LIVE: LobbyTile[] = [
  { slug: "horse-race", game: "card-race", title: "Horse race", tagline: "Four legendary aces race the deck. Play one race or four at once.", badge: "Up to 100×" },
  { slug: "coin-flip", game: "coin-flip", title: "Coin flip", tagline: "Xerxes or 300 — call the side.", badge: "2×" },
];

export const LOBBY_SOON: LobbyTile[] = [
  { slug: "xerxes-vs-robot", title: "Xerxes vs AI robot", tagline: "The god-king against the machine.", badge: "Coming soon" },
  { slug: "chicken", title: "Chicken", tagline: "Dare the road, one step at a time.", badge: "Coming soon" },
  { slug: "dice", title: "Dice", tagline: "Roll the dice, call the number.", badge: "Coming soon" },
  { slug: "sparta-board", title: "Sparta Board", tagline: "Roll and march around the board.", badge: "Coming soon" },
  { slug: "wheel", title: "Wheel of 300", tagline: "Spin the wheel of fortune.", badge: "Coming soon" },
];

export const isPlayableGame = (id: string): id is GameId => isKnownGame(id) && !RETIRED.has(id);

export const choiceLabel = (game: string, index: number) => (isKnownGame(game) ? (GAME_COPY[game].choices[index] ?? `#${index + 1}`) : `#${index + 1}`);

export const formatMultiplier = (payoutBps: number) => `${Number((payoutBps / 10000).toFixed(2))}×`;

/** Deterministic 0..1 values from a round id, for cosmetic animation details. */
export const cosmetic = (seed: number, index: number) => {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
