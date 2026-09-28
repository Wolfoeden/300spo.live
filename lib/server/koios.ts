// Server-side Koios access. The public tier answers in 1–8 s, so callers keep
// to one or two requests per function invocation.
const KOIOS = "https://api.koios.rest/api/v1";

const RATE_LIMIT_RETRY_MS = 1500;

export const koios = async <T>(path: string, body?: unknown, timeoutMs = 8500): Promise<T> => {
  const request = () =>
    fetch(`${KOIOS}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  let response = await request();
  // The public tier rate-limits shared Netlify IPs now and then; one pause usually clears it.
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    response = await request();
  }
  if (!response.ok) throw new Error(`Koios ${path} returned ${response.status}`);
  return (await response.json()) as T;
};

export const tipHeight = async (timeoutMs?: number) => {
  const [tip] = await koios<{ block_height: number }[]>("tip", undefined, timeoutMs);
  return Number(tip.block_height);
};

export const txInfo = <T>(hashes: string[], timeoutMs?: number) =>
  koios<T[]>(
    "tx_info",
    { _tx_hashes: hashes, _inputs: true, _metadata: true, _assets: true, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false },
    timeoutMs,
  );
