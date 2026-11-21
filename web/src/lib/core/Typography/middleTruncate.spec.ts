import { describe, expect, it } from "vitest";
import { ELLIPSIS, middleTruncate } from "./middleTruncate";

// One unit of width per character, so a width reads as a character count.
const byLength = (value: string) => Array.from(value).length;

describe("middleTruncate", () => {
  it("returns a text that fits unchanged", () => {
    expect(middleTruncate("payment-api", 20, byLength)).toBe("payment-api");
  });

  it("keeps the start and the tail around one ellipsis, filling the width", () => {
    const cut = middleTruncate("payment-service-production-eu-west-1", 15, byLength);
    expect(cut).toBe(`payment${ELLIPSIS}-west-1`);
    expect(byLength(cut)).toBe(15);
  });

  it("tells apart values that share a long prefix by their tails", () => {
    const pods = ["checkout-7d9f8c6b5-abcde", "checkout-7d9f8c6b5-vwxyz"];
    const [first, second] = pods.map((pod) => middleTruncate(pod, 14, byLength));
    expect(first).not.toBe(second);
    expect(first.endsWith("abcde")).toBe(true);
  });

  it("falls back to the ellipsis alone when nothing else fits", () => {
    expect(middleTruncate("abcdef", 1, byLength)).toBe(ELLIPSIS);
  });

  it("never splits a character made of two code units", () => {
    const cut = middleTruncate("😀😀😀😀😀😀😀😀", 5, byLength);
    expect(cut).toBe(`😀😀${ELLIPSIS}😀😀`);
  });
});
