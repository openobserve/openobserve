// Polyfill crypto.getRandomValues for Node < 19
import { randomFillSync } from "crypto";

if (!globalThis.crypto?.getRandomValues) {
  (globalThis.crypto as any) = {
    ...globalThis.crypto,
    getRandomValues: (arr: Uint8Array) => randomFillSync(arr),
  };
}
