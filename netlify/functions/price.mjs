const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=240",
      ...(init.headers || {}),
    },
  });

export default async () => {
  try {
    const response = await fetch("https://agg-api.minswap.org/aggregator/ada-price?currency=usd");
    if (!response.ok) throw new Error(`Minswap returned ${response.status}`);
    const payload = await response.json();
    return json({
      adaUsd: payload?.value?.price ?? null,
      adaChange24h: payload?.value?.change_24h ?? null,
      tokenPriceUsd: null,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: "price_unavailable", message: error.message }, { status: 502 });
  }
};

export const config = {
  path: "/api/price",
};
