// What each game's outcome indices mean. The database only knows numbers;
// index i here is outcome i in game.play().

export type GameId = "coin-flip" | "horse-race" | "xerxes-vs-robot";

export const HORSES = [
  { name: "Thermopylae", color: "#e9b44c" },
  { name: "Sparta", color: "#e5484d" },
  { name: "Persepolis", color: "#7c66dc" },
  { name: "Immortal", color: "#30a46c" },
  { name: "Cardano", color: "#3e63dd" },
] as const;

export const GAME_COPY: Record<GameId, { title: string; tagline: string; choices: string[] }> = {
  "coin-flip": { title: "Coin flip", tagline: "Xerxes or 300? Call the side.", choices: ["Xerxes", "300"] },
  "horse-race": { title: "Horse race", tagline: "Five horses, one winner. Pick it.", choices: HORSES.map((horse) => horse.name) },
  "xerxes-vs-robot": { title: "Xerxes vs AI robot", tagline: "The god-king against the machine. Who stands?", choices: ["Xerxes", "AI robot"] },
};

export const isKnownGame = (id: string): id is GameId => id in GAME_COPY;

export const choiceLabel = (game: string, index: number) => (isKnownGame(game) ? (GAME_COPY[game].choices[index] ?? `#${index + 1}`) : `#${index + 1}`);

export const formatMultiplier = (payoutBps: number) => `${Number((payoutBps / 10000).toFixed(2))}×`;

/** Deterministic 0..1 values from a round id, for cosmetic animation details. */
export const cosmetic = (seed: number, index: number) => {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
