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
import { gt } from "@/types/i18n";
import {
  endOfDayMicros,
  makePublicLinkSchema,
  publicLinkDefaults,
  publicLinkFormFrom,
  todayIn,
  toPublicLinkConfig,
} from "./PublicLinkForm.schema";
import type { PublicLink } from "@/services/public_dashboards_admin";

const schema = makePublicLinkSchema(gt, 30, "2026-09-25");

const named = () => ({ ...publicLinkDefaults(), name: "NOC wall" });

describe("PublicLinkForm schema", () => {
  it("accepts a named link with the default settings", () => {
    expect(schema.safeParse(named()).success).toBe(true);
  });

  it("requires a name", () => {
    const r = schema.safeParse({ ...named(), name: "   " });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["name"]);
  });

  it("rejects a refresh below the server minimum", () => {
    const r = schema.safeParse({ ...named(), rebuildSecs: "10" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["rebuildSecs"]);
  });

  it("rejects an expiry before today but allows today", () => {
    expect(schema.safeParse({ ...named(), expires: "2026-09-24" }).success).toBe(false);
    expect(schema.safeParse({ ...named(), expires: "2026-09-25" }).success).toBe(true);
  });

  it("needs a default that is one of the available ranges when viewers can switch", () => {
    const r = schema.safeParse({ ...named(), presets: [86400], defaultPreset: 3600 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["defaultPreset"]);
  });

  it("needs at least one time range", () => {
    const r = schema.safeParse({ ...named(), presets: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["presets"]);
  });
});

describe("PublicLinkForm payload", () => {
  it("ends the chosen day in the author's timezone", () => {
    const micros = endOfDayMicros("2026-10-01", "Asia/Kolkata");
    expect(new Date(micros / 1000).toISOString()).toBe("2026-10-01T18:29:59.999Z");
  });

  it("reads today in the author's timezone", () => {
    expect(todayIn("Asia/Kolkata", new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26");
  });

  it("fixes the link to a single range, with numbers and a trimmed name", () => {
    const cfg = toPublicLinkConfig(
      { ...publicLinkDefaults(), name: "  NOC  ", presets: [900], defaultPreset: 900 },
      { env: "prod" },
      "UTC",
    );
    expect(cfg).toEqual({
      name: "NOC",
      visibility: "public",
      time_range: { editable: false, default_range_secs: 900, allowed_presets_secs: [900] },
      frozen_variables: { env: "prod" },
      rebuild_secs: 60,
      expires_at: null,
    });
  });

  it("lets viewers switch only when several ranges are picked", () => {
    const cfg = toPublicLinkConfig(
      { ...publicLinkDefaults(), name: "x", presets: [86400, 3600], defaultPreset: 3600 },
      {},
      "UTC",
    );
    expect(cfg.time_range).toEqual({
      editable: true,
      default_range_secs: 3600,
      allowed_presets_secs: [3600, 86400],
    });
  });

  it("edits a fixed link as its one range", () => {
    const link = {
      name: "a",
      rebuild_secs: 60,
      expires_at: null,
      time_range: { editable: false, default_range_secs: 900, allowed_presets_secs: [900] },
    } as unknown as PublicLink;
    expect(publicLinkFormFrom(link, "UTC").presets).toEqual([900]);
  });

  it("round-trips a link's expiry through the edit form", () => {
    const expires_at = endOfDayMicros("2026-12-31", "America/New_York");
    const link = {
      name: "a",
      rebuild_secs: 120,
      expires_at,
      time_range: {
        editable: true,
        default_range_secs: 86400,
        allowed_presets_secs: [3600, 86400],
      },
    } as PublicLink;
    const value = publicLinkFormFrom(link, "America/New_York");
    expect(value.expires).toBe("2026-12-31");
    expect(toPublicLinkConfig(value, {}, "America/New_York").expires_at).toBe(expires_at);
  });
});
