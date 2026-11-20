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

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { shareLinkCopiedMessage } from "./useShareLink";

const t = (i18n.global as any).t as TranslateFn;

describe("shareLinkCopiedMessage", () => {
  it("names the fixed range a link with from/to opens on", () => {
    // 2026-11-14 02:00 and 02:15 UTC, in microseconds.
    const url = "https://o2.example/web/logs?from=1794621600000000&to=1794622500000000";
    expect(shareLinkCopiedMessage(url, t, "UTC")).toBe(
      "Link copied · fixed time 2026-11-14 02:00 – 2026-11-14 02:15",
    );
  });

  it("says a relative link moves with the clock", () => {
    expect(shareLinkCopiedMessage("https://o2.example/web/logs?period=15m", t)).toBe(
      "Link copied · Past 15 minutes, counted from when it is opened",
    );
  });

  it("falls back to a plain confirmation without a time in the link", () => {
    expect(shareLinkCopiedMessage("https://o2.example/web/logs?stream=a", t)).toBe("Link copied");
  });
});
