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

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  matchCrossLinks,
  openCrossLink,
  resolveCrossLinkUrl,
  type CrossLinks,
} from "./crossLinking";
import type { CrossLink } from "@/composables/useLogs/searchState";

const link = (name: string, field: { name: string; alias?: string }): CrossLink => ({
  name,
  url: `https://${name}.example.com`,
  fields: [field],
});

describe("matchCrossLinks", () => {
  it.each<[string, CrossLinks, string, string[]]>([
    [
      "a link on the field matches",
      { org_links: [link("a", { name: "f", alias: "f" })] },
      "f",
      ["a"],
    ],
    [
      "a link on another field does not",
      { org_links: [link("a", { name: "g", alias: "g" })] },
      "f",
      [],
    ],
    ["a field without alias does not match", { org_links: [link("a", { name: "f" })] }, "f", []],
    [
      "a stream link overrides an org link on the same field",
      {
        stream_links: [link("s", { name: "f", alias: "f" })],
        org_links: [link("o", { name: "f", alias: "f" })],
      },
      "f",
      ["s"],
    ],
  ])("%s", (_case, crossLinks, fieldName, expected) => {
    expect(matchCrossLinks(crossLinks, fieldName).links.map((l) => l.name)).toEqual(expected);
  });

  it("maps an alias back to the original field name", () => {
    const { originalFieldName } = matchCrossLinks(
      { org_links: [link("a", { name: "trace_id", alias: "tid" })] },
      "tid",
    );
    expect(originalFieldName).toBe("trace_id");
  });
});

describe("resolveCrossLinkUrl", () => {
  const ctx = {
    fieldName: "session id",
    fieldValue: "a b&c",
    startTime: 1700000000000000,
    endTime: 1700000060000000,
    query: "x=1",
  };

  it.each([
    ["${field.__name}", "session%20id"],
    ["${field.__value}", "a%20b%26c"],
    ["${start_time}", "1700000000000000"],
    ["${end_time}", "1700000060000000"],
    ["${query}", "x%3D1"],
    ["${query_encoded}", btoa("x=1")],
  ])("replaces %s", (placeholder, expected) => {
    expect(resolveCrossLinkUrl(`https://e.com/?q=${placeholder}`, ctx)).toBe(
      `https://e.com/?q=${expected}`,
    );
  });
});

describe("openCrossLink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a safe URL and ignores an unsafe one", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    openCrossLink("javascript:alert(1)");
    expect(openSpy).not.toHaveBeenCalled();

    openCrossLink("https://example.com/x");
    expect(openSpy).toHaveBeenCalledWith("https://example.com/x", "_blank", "noopener,noreferrer");
  });
});
