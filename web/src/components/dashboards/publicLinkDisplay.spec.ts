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
import { publicLinkSearchTerm, publicLinkUrl } from "@/components/dashboards/publicLinkDisplay";
import type { PublicLink } from "@/services/public_dashboards_admin";

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
