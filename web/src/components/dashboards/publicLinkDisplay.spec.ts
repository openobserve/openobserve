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

import { afterEach, describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import {
  attentionReason,
  displayStatus,
  lifecycleStatus,
  publicLinkColumns,
  publicLinkSearchTerm,
  publicLinkUrl,
} from "@/components/dashboards/publicLinkDisplay";
import type {
  PublicLink,
  PublicLinkRangeStatus,
  PublicLinkStatusReport,
} from "@/services/public_dashboards_admin";

const link = { slug: "abc" } as PublicLink;

describe("publicLinkUrl", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("puts the public page under /web/", () => {
    window.history.replaceState(null, "", "/web/dashboards/view");
    expect(publicLinkUrl(link)).toBe(`${window.location.origin}/web/public/dashboards/abc`);
  });

  it("keeps a base URI the server is mounted under", () => {
    window.history.replaceState(null, "", "/o2/web/dashboards");
    expect(publicLinkUrl(link)).toBe(`${window.location.origin}/o2/web/public/dashboards/abc`);
  });
});

describe("publicLinkSearchTerm", () => {
  it("reduces a pasted public URL to its slug", () => {
    expect(
      publicLinkSearchTerm(" https://o2.example.com/o2/web/public/dashboards/AbC12?tab=x "),
    ).toBe("abc12");
  });

  it("lowercases and trims anything else", () => {
    expect(publicLinkSearchTerm("  NOC Wall ")).toBe("noc wall");
  });
});

const row = (over: Partial<PublicLink>) =>
  ({ status: "live", access_count: 3, ...over }) as PublicLink;
const range = (over: Partial<PublicLinkRangeStatus>): PublicLinkRangeStatus => ({
  key: "r3600",
  state: "cached",
  built_at: 1,
  withheld_panels: [],
  unavailable_count: 0,
  incomplete_count: 0,
  last_error: null,
  ...over,
});
const report = (...ranges: PublicLinkRangeStatus[]): PublicLinkStatusReport => ({
  link_id: "l1",
  ranges,
  access_count: 3,
  last_accessed_at: 1,
});

describe("public link status", () => {
  it("reads a live link nobody opened as never viewed, and keeps every other state", () => {
    expect(lifecycleStatus(row({ access_count: 0 }))).toBe("not_viewed");
    expect(lifecycleStatus(row({}))).toBe("live");
    expect(lifecycleStatus(row({ status: "paused", access_count: 0 }))).toBe("paused");
    expect(lifecycleStatus(row({ status: "expired" }))).toBe("expired");
  });

  it("raises a live link to needs attention only from its status report", () => {
    const failing = report(range({ state: "needs_attention", last_error: "timeout" }));
    expect(displayStatus(row({}), undefined)).toBe("live");
    expect(displayStatus(row({}), report(range({})))).toBe("live");
    expect(displayStatus(row({}), failing)).toBe("needs_attention");
    expect(displayStatus(row({ status: "paused" }), failing)).toBe("paused");
  });

  it("says why a link needs attention: a failed build first, else the panels it can't show", () => {
    const withheld = range({
      state: "needs_attention",
      unavailable_count: 1,
      withheld_panels: [
        { panel_id: "p1", reason: "unauthorized" },
        { panel_id: "p2", reason: "too_large" },
      ],
    });
    expect(attentionReason(report(range({})), gt)).toBeNull();
    expect(attentionReason(report(withheld), gt)).toBe(
      "2 panels aren't available on the public view",
    );
    expect(
      attentionReason(report(withheld, range({ state: "needs_attention", last_error: "x" })), gt),
    ).toBe("The last build failed. Viewers see older data where there is some.");
  });

  it("shows Last viewed from the access time, not an update time", () => {
    const ids = publicLinkColumns(gt).map((c) => c.id);
    expect(ids).toContain("last_viewed");
    expect(ids).not.toContain("updated");
    expect(publicLinkColumns(gt).find((c) => c.id === "last_viewed")?.accessorKey).toBe(
      "last_accessed_at",
    );
  });
});
