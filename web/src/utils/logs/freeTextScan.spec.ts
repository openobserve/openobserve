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
import {
  FREE_TEXT_I18N,
  decodeFtScan,
  encodeFtScan,
  freeTextGateFlags,
  pruneFreeTextScan,
  sanitizeFreeTextScan,
  type FreeTextScanHolder,
} from "./freeTextScan";
import { b64EncodeUnicode } from "@/utils/formatters";
import {
  ITEM1_TRANSIENT_KEYS,
  applySearchSnapshot,
  prepareSearchForSave,
} from "@/utils/logs/transientSearchKeys";
import { mergeDeep } from "@/utils/queryUtils";

const holder = (streams: string[], scan: Record<string, any> = {}): FreeTextScanHolder => ({
  meta: { sqlMode: false, freeTextScan: scan },
  data: { stream: { selectedStream: streams }, freeTextBlocked: null },
});

describe("ft_scan codec (AC3.9)", () => {
  it("round-trips the map", () => {
    const map = {
      nofts_b: { fields: ["msg_text", "detail"] },
      s: { fields: ["x"], materialized: true },
    };
    const param = encodeFtScan(map);
    expect(param).not.toBeNull();
    expect(decodeFtScan(param)).toEqual(map);
  });

  it("writes nothing for an empty map", () => {
    expect(encodeFtScan({})).toBeNull();
    expect(encodeFtScan(undefined)).toBeNull();
  });

  it("ignores malformed input instead of throwing", () => {
    expect(decodeFtScan("%%%not-base64")).toEqual({});
    expect(decodeFtScan(b64EncodeUnicode("[1,2]"))).toEqual({});
    expect(decodeFtScan(b64EncodeUnicode("{not json"))).toEqual({});
    expect(decodeFtScan(undefined)).toEqual({});
    expect(decodeFtScan(["a"])).toEqual({});
  });

  it("drops entries without a field list and non-string fields", () => {
    expect(
      sanitizeFreeTextScan({
        a: { fields: [] },
        b: { fields: "msg" },
        c: { fields: ["msg", 3, ""] },
        d: null,
        "": { fields: ["x"] },
        e: { fields: ["y"], materialized: "yes" },
      }),
    ).toEqual({ c: { fields: ["msg"] }, e: { fields: ["y"] } });
  });
});

describe("pruneFreeTextScan", () => {
  it("drops entries of streams that are no longer selected", () => {
    const obj = holder(["a"], { a: { fields: ["x"] }, b: { fields: ["y"] } });
    pruneFreeTextScan(obj);
    expect(obj.meta.freeTextScan).toEqual({ a: { fields: ["x"] } });
  });
});

describe("freeTextGateFlags (G1 inputs)", () => {
  const t = (key: string) => `t:${key}`;

  it("reports blocked for every action while text search is blocked", () => {
    const obj = holder(["a"]);
    obj.data.freeTextBlocked = { streams: ["a"] };
    expect(freeTextGateFlags(obj, t)).toEqual({
      blockedReason: `t:${FREE_TEXT_I18N.blocked}`,
      scanReason: null,
    });
  });

  it("reports scan provenance for a selected stream only", () => {
    expect(freeTextGateFlags(holder(["a"], { b: { fields: ["x"] } }), t).scanReason).toBeNull();
    expect(freeTextGateFlags(holder(["a"], { a: { fields: ["x"] } }), t).scanReason).toBe(
      `t:${FREE_TEXT_I18N.scan}`,
    );
  });
});

describe("saved-view registry for item 1 (P3-R2)", () => {
  const live = () => ({
    meta: { freeTextScan: { a: { fields: ["x"] } } },
    data: { query: "timeout", freeTextBlocked: { streams: ["a"] } },
  });

  it("registers freeTextBlocked as reset and freeTextScan as replace", () => {
    expect(ITEM1_TRANSIENT_KEYS.map((k) => [k.path, k.mode])).toEqual([
      ["data.freeTextBlocked", "reset"],
      ["data.freeTextExcluded", "reset"],
      ["data.freeTextDecorations", "reset"],
      ["meta.freeTextScan", "replace"],
    ]);
  });

  it("saves scan consent but never the blocked state", () => {
    const saved = prepareSearchForSave(JSON.parse(JSON.stringify(live())), live());
    expect(saved.meta.freeTextScan).toEqual({ a: { fields: ["x"] } });
    expect("freeTextBlocked" in saved.data).toBe(false);
  });

  it("clears live consent when an older view without the key is applied", () => {
    const target = live();
    applySearchSnapshot(target, { data: { query: "level='x'" }, meta: {} }, mergeDeep);
    expect(target.meta.freeTextScan).toEqual({});
    expect(target.data.freeTextBlocked).toBeNull();
  });

  it("replaces, never merges, a view's different scan map", () => {
    const target = live();
    applySearchSnapshot(target, { meta: { freeTextScan: { b: { fields: ["y"] } } } }, mergeDeep);
    expect(target.meta.freeTextScan).toEqual({ b: { fields: ["y"] } });
  });
});
