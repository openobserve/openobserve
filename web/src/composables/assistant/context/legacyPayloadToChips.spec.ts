// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import { legacyAutoSend, legacyPayloadToChips, legacyRelayArgs } from "./legacyPayloadToChips";

const ROW = {
  _timestamp: 1_768_400_266_000_000,
  _stream_name: "cart",
  level: "error",
  _o2_id: "9",
};

describe("legacyPayloadToChips", () => {
  it("turns a JSON row into a log_row chip and never into prompt text (`40` §4)", () => {
    const { chips, text } = legacyPayloadToChips(JSON.stringify(ROW));
    expect(text).toBeUndefined();
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      kind: "log_row",
      provenance: "door",
      sent: "serialized",
      data: ROW,
    });
    expect(chips[0].label).toMatch(/^Log row · cart · .*\d\d:\d\d$/);
  });

  it("keeps anything else as editable prompt text", () => {
    expect(legacyPayloadToChips("Explain this error")).toEqual({
      chips: [],
      text: "Explain this error",
    });
    expect(legacyPayloadToChips("[not json")).toEqual({ chips: [], text: "[not json" });
    expect(legacyPayloadToChips("   ")).toEqual({ chips: [] });
  });

  it("reads the { query, autoSend } object form", () => {
    expect(legacyPayloadToChips({ query: "Why is it slow?", autoSend: true })).toEqual({
      chips: [],
      text: "Why is it slow?",
    });
    expect(legacyAutoSend({ query: "x", autoSend: true })).toBe(true);
    expect(legacyAutoSend("x", true)).toBe(true);
    expect(legacyAutoSend({ query: "x" }, true)).toBe(false);
  });

  it("keeps several rows as one chip with a count", () => {
    const { chips } = legacyPayloadToChips(JSON.stringify([ROW, { ...ROW, level: "warn" }]));
    expect(chips[0]).toMatchObject({ kind: "log_row", count: 2, label: "Log rows · 2 · cart" });
  });

  it("gives the same row the same id, so a repeated relay is one chip", () => {
    const a = legacyPayloadToChips(JSON.stringify(ROW)).chips[0];
    const b = legacyPayloadToChips(JSON.stringify(ROW)).chips[0];
    expect(a.id).toBe(b.id);
  });

  it("keeps a multi-row payload over 32 KB an array of rows, cut to fit, labelled with the rows kept (F1, F10)", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...ROW, i, message: "y".repeat(5_000) }));
    const chip = legacyPayloadToChips(JSON.stringify(many)).chips[0];
    expect(Array.isArray(chip.data)).toBe(true);
    expect(chip.sizeBytes).toBeLessThanOrEqual(32 * 1024);
    const kept = (chip.data as unknown[]).length;
    expect(chip.count).toBe(kept);
    expect(chip.truncated).toContain("rows");
    expect(kept).toBeLessThan(10);
    expect(chip.label).toBe(`Log rows · ${kept} · cart`);
  });

  it("cuts a row over 32 KB instead of refusing it", () => {
    const chip = legacyPayloadToChips(JSON.stringify({ message: "x".repeat(40_000) })).chips[0];
    expect(chip.truncated).toEqual(["message"]);
    expect(chip.sizeBytes).toBeLessThanOrEqual(32 * 1024);
  });
});

describe("legacyRelayArgs", () => {
  // Flips O2AIChat.session.spec.ts:1060 ("a payload with autoSend false is dropped"): it is staged.
  it("stages a payload whose autoSend is false, as chips and text", () => {
    const args = legacyRelayArgs({ query: "never sent", autoSend: false });
    expect(args).toMatchObject({
      entryKind: "legacy_relay",
      intent: "stage",
      entryVerb: "add_to_chat",
      payload: { chips: [], text: "never sent" },
    });
  });

  it("asks to send an auto-send payload through the one door, which never sends over a draft", () => {
    const args = legacyRelayArgs(JSON.stringify(ROW), true);
    expect(args).toMatchObject({ intent: "send", entryVerb: "explain", objectKind: "log_row" });
    expect(args.payload?.chips).toHaveLength(1);
  });

  it("keeps a row with a query column as a row, and a JSON value with no rows as text (S2)", () => {
    const row = { ...ROW, query: "SELECT 1" };
    const { chips, text } = legacyPayloadToChips(JSON.stringify(row));
    expect(text).toBeUndefined();
    expect(chips[0].data).toEqual(row);
    expect(legacyAutoSend(row, false)).toBe(false);
    expect(legacyPayloadToChips('["a","b"]')).toEqual({ chips: [], text: '["a","b"]' });
  });
});
