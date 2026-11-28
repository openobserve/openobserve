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
  agentHomeState,
  aiTabMode,
  askOffReason,
  periodToMs,
  readHomeUrl,
  threadPeriodOf,
} from "./homeState";

const ent = { isEnterprise: true, isCloud: false };

describe("agentHomeState", () => {
  it("reads ai, budget, noai and oss", () => {
    expect(agentHomeState({ ...ent, gate: "available", creditMode: "included" as any })).toBe("ai");
    expect(agentHomeState({ ...ent, gate: "available", creditMode: "exhausted" })).toBe("budget");
    expect(agentHomeState({ ...ent, gate: "off_for_org", creditMode: null })).toBe("noai");
    expect(
      agentHomeState({ isEnterprise: false, isCloud: false, gate: "available", creditMode: null }),
    ).toBe("oss");
  });

  it("says why the Ask box is unavailable", () => {
    expect(askOffReason({ ...ent, gate: "available", creditMode: null })).toBeNull();
    expect(askOffReason({ ...ent, gate: "available", creditMode: "exhausted" })).toBe("budget");
    expect(askOffReason({ ...ent, gate: "no_permission", creditMode: null })).toBe("no_permission");
  });
});

describe("aiTabMode", () => {
  const loaded = { ...ent, configLoaded: true };
  const arriving = { ...ent, configLoaded: false };

  it("opens Home on the AI tab while the assistant is usable, or while the config is still arriving", () => {
    expect(aiTabMode({ ...loaded, gate: "available", menu: "enabled" })).toBe("default");
    expect(aiTabMode({ ...loaded, gate: "loading", menu: "enabled" })).toBe("default");
    expect(aiTabMode({ ...arriving, gate: "loading", menu: "hidden" })).toBe("default");
  });

  it("hides the AI tab at once when the loaded config says AI is off, even while the gate loads", () => {
    expect(aiTabMode({ ...loaded, gate: "loading", menu: "hidden" })).toBe("hidden");
  });

  it("hides the AI tab when AI is off or not permitted", () => {
    expect(aiTabMode({ ...loaded, gate: "off_for_org", menu: "enabled" })).toBe("hidden");
    expect(aiTabMode({ ...loaded, gate: "no_permission", menu: "enabled" })).toBe("hidden");
    expect(aiTabMode({ ...loaded, gate: "available", menu: "hidden" })).toBe("hidden");
  });

  it("keeps a license-locked tab", () => {
    expect(aiTabMode({ ...loaded, gate: "not_entitled", menu: "locked" })).toBe("default");
  });

  it("hides the AI tab on Open Source, as main does", () => {
    const oss = { isEnterprise: false, isCloud: false, configLoaded: true };
    expect(aiTabMode({ ...oss, gate: "not_entitled", menu: "hidden" })).toBe("hidden");
    expect(aiTabMode({ ...oss, gate: "loading", menu: "enabled", configLoaded: false })).toBe(
      "hidden",
    );
  });
});

describe("readHomeUrl", () => {
  it("reads a relative period", () => {
    expect(readHomeUrl({ period: "1h" })).toEqual({
      range: { type: "relative", period: "1h" },
    });
  });

  it("reads an absolute range in microseconds", () => {
    expect(readHomeUrl({ from: "100", to: "200" }).range).toEqual({
      type: "absolute",
      from: 100,
      to: 200,
    });
  });

  it.each([
    [{ period: "soon" }, { range: null }],
    [{ period: "1h", from: "1", to: "2" }, { range: null }],
    [{ from: "200", to: "100" }, { range: null }],
    [{ from: "100" }, { range: null }],
    [{ from: "1e5", to: "2e5" }, { range: null }],
  ])("restores nothing from a malformed part %#", (query, expected) => {
    expect(readHomeUrl(query)).toEqual(expected);
  });
});

describe("periodToMs", () => {
  it("reads relative periods and falls back to 15 minutes", () => {
    expect(periodToMs("24h")).toBe(86_400_000);
    expect(periodToMs("15m")).toBe(900_000);
    expect(periodToMs("bogus")).toBe(900_000);
  });
});

describe("threadPeriodOf", () => {
  it("gives a thread on Home no window of its own when the URL names none, so it reads the 15 min default", () => {
    expect(threadPeriodOf({})).toBeNull();
  });

  it("follows the range the URL names", () => {
    expect(threadPeriodOf({ period: "1h" })).toEqual({ period: "1h", ms: 3_600_000 });
  });
});
