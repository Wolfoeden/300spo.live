import { drepCredential, sameBytes } from "./cardano/address";
import { DREP_ID, POOL_ID } from "./site";

/** Koios reports DReps in either CIP-129 or legacy bech32; compare the credential, not the string. */
export const isOurDrep = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("drep")) return false;
  try {
    return sameBytes(drepCredential(value).hash, drepCredential(DREP_ID).hash);
  } catch {
    return false;
  }
};

export const isOurPool = (value: unknown) => value === POOL_ID;
