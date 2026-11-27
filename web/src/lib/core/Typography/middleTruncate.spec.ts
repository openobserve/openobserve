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

  describe("keeps every user-perceived character whole", () => {
    // One unit per grapheme, so each test cuts by visible characters.
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const byGrapheme = (value: string) => Array.from(segmenter.segment(value)).length;

    it("never splits a flag into its two regional indicators", () => {
      const flag = "🇮🇳";
      const cut = middleTruncate(flag.repeat(8), 5, byGrapheme);
      expect(cut).toBe(`${flag.repeat(2)}${ELLIPSIS}${flag.repeat(2)}`);
    });

    it("never splits an emoji joined with zero-width joiners", () => {
      const family = "👨‍👩‍👧";
      const cut = middleTruncate(family.repeat(8), 5, byGrapheme);
      expect(cut).toBe(`${family.repeat(2)}${ELLIPSIS}${family.repeat(2)}`);
    });

    it("never separates a letter from its combining accent", () => {
      const accented = "e\u0301";
      const cut = middleTruncate(accented.repeat(8), 5, byGrapheme);
      expect(cut).toBe(`${accented.repeat(2)}${ELLIPSIS}${accented.repeat(2)}`);
    });
  });
});
