import { walletErrorCode, walletErrorMessage } from "./cardano/cip30";
import { InsufficientFundsError, type ProtocolParams } from "./cardano/tx";

/** GETs from the /api/chain proxy; one retry absorbs most hiccups of the slow public Koios tier. */
export const fetchChain = async <T>(path: string, attempts = 2): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) return (await response.json()) as T;
      if (response.status < 500 || attempt >= attempts) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
  }
};

type ParamsResponse = { minFeeA: string; minFeeB: string; keyDeposit: string; coinsPerUtxoByte: string; maxTxSize: number };

export const loadProtocolParams = async (): Promise<ProtocolParams> => {
  const params = await fetchChain<ParamsResponse>("/api/chain/params");
  return {
    minFeeA: BigInt(params.minFeeA),
    minFeeB: BigInt(params.minFeeB),
    keyDeposit: BigInt(params.keyDeposit),
    coinsPerUtxoByte: BigInt(params.coinsPerUtxoByte),
    maxTxSize: params.maxTxSize,
  };
};

export type TxStage = "build" | "sign" | "submit";

/** CIP-30 codes differ per call: signTx 2 = user declined, submitTx 2 = rejected by the network. */
export const transactionErrorMessage = (error: unknown, stage: TxStage) => {
  if (error instanceof InsufficientFundsError || error instanceof Error) return error.message;
  const code = walletErrorCode(error);
  if (code === -3 || (stage === "sign" && code === 2)) return "The transaction was declined in your wallet.";
  if (stage === "submit") return `The network rejected the transaction: ${walletErrorMessage(error)}`;
  return walletErrorMessage(error);
};
