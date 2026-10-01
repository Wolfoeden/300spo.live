"use client";

// Live updates from the database: game tables push their public state as
// Supabase Realtime broadcasts (game.bj_publish), so every browser at a table
// sees each card the moment it is dealt, without polling. The key is the
// project's publishable key — public by design; it opens no table (every game
// table is behind row level security and reachable only through the API).
const REALTIME_URL = "wss://uhxwaonnkvicfekzefbn.supabase.co/realtime/v1";
const PUBLISHABLE_KEY = "sb_publishable_FyIUPQiDAMP9nKMR6ncWRQ__DX26GXn";

/**
 * Listens to one broadcast event on a public topic. `onLive` reports whether
 * the subscription stands (callers poll while it does not). Returns the unsubscribe.
 */
export function subscribeBroadcast<T>(topic: string, event: string, onMessage: (payload: T) => void, onLive: (live: boolean) => void) {
  let closed = false;
  let close = () => {};
  import("@supabase/realtime-js")
    .then(({ RealtimeClient }) => {
      if (closed) return;
      const client = new RealtimeClient(REALTIME_URL, { params: { apikey: PUBLISHABLE_KEY } });
      const channel = client.channel(topic, { config: { broadcast: { self: false } } });
      channel.on("broadcast", { event }, (message) => onMessage(message.payload as T));
      channel.subscribe((status) => onLive(status === "SUBSCRIBED"));
      close = () => {
        void client.removeChannel(channel);
        void client.disconnect();
      };
    })
    .catch(() => onLive(false));
  return () => {
    closed = true;
    close();
  };
}
