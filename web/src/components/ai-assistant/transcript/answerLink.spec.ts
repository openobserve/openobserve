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

import type { ShareView } from "@/services/ai_chat_share";

import { activeShareUrl, answerAnchor, answerLink, answerTurnOf } from "./answerLink";

describe("answerLink", () => {
  it("links to the thread on Home with the answer anchor", () => {
    const link = answerLink(
      { org: "default", sid: "s1", turnId: "t 2" },
      "https://o2.dev",
      "/web/",
    );
    const url = new URL(link);
    expect(url.pathname).toBe("/web/");
    expect(url.searchParams.get("org_identifier")).toBe("default");
    expect(url.searchParams.get("tab")).toBe("ai");
    expect(url.searchParams.get("thread")).toBe("s1");
    expect(answerTurnOf(url.hash)).toBe("t 2");
  });

  it("adds the anchor to the chat's share link, replacing any fragment", () => {
    const link = answerLink(
      { org: "o", sid: "s", turnId: "t1", shareUrl: "https://o2.dev/web/ai/shared/tok#old" },
      "https://ignored",
    );
    expect(link).toBe("https://o2.dev/web/ai/shared/tok#answer-t1");
  });

  it("carries no query of its own, so opening it runs nothing", () => {
    const url = new URL(answerLink({ org: "o", sid: "s", turnId: "t" }, "https://x", "/"));
    expect([...url.searchParams.keys()].sort()).toEqual(["org_identifier", "tab", "thread"]);
  });
});

describe("answerTurnOf", () => {
  it("reads only answer anchors", () => {
    expect(answerTurnOf(`#${answerAnchor("t9")}`)).toBe("t9");
    expect(answerTurnOf("#other")).toBeNull();
    expect(answerTurnOf("")).toBeNull();
    expect(answerTurnOf("#answer-%E0%A4%A")).toBeNull();
  });
});

describe("activeShareUrl (WT-03)", () => {
  const share = (over: Partial<ShareView>): ShareView => ({
    id: "s",
    url_path: "/web/ai/shared/tok",
    mode: "live",
    visibility: "org",
    snapshot_seq: null,
    expires_at: null,
    created_at: 1,
    updated_at: 1,
    access_count: 0,
    last_accessed_at: null,
    session_id: "sid",
    title: "t",
    redact_tools: true,
    ...over,
  });

  it("skips expired, linkless and stale-snapshot shares", () => {
    const now = 2_000_000;
    expect(
      activeShareUrl(
        [
          share({ url_path: "/web/ai/shared/expired", expires_at: now - 1 }),
          share({ url_path: undefined }),
          share({ url_path: "/web/ai/shared/stale", mode: "snapshot", snapshot_seq: 3 }),
          share({ url_path: "/web/ai/shared/ok", mode: "snapshot", snapshot_seq: 9 }),
        ],
        9,
        now,
      ),
    ).toMatch(/\/ai\/shared\/ok$/);
    expect(activeShareUrl([share({ expires_at: now - 1 })], 9, now)).toBeNull();
    expect(activeShareUrl(undefined, null)).toBeNull();
  });
});
