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
  FACET_GROUPS,
  MAX_SIGNATURE_MESSAGE_LEN,
  availableFacets,
  buildBreadcrumbsSql,
  buildFacetSql,
  buildIssueImpactSql,
  buildIssueOccurrencesSql,
  buildSignatureWhere,
  pivotFacet,
  type ErrorDetailContext,
} from "@/utils/rum/errorDetailQueries";

const FULL_SCHEMA = {
  error_type: true,
  error_message: true,
  error_handling: true,
  session_id: true,
  usr_id: true,
  user_agent_user_agent_family: true,
  user_agent_os_family: true,
  version: true,
  view_url: true,
};

const makeContext = (overrides: Partial<ErrorDetailContext> = {}): ErrorDetailContext => ({
  streamName: "_rumdata",
  timestampColumn: "_timestamp",
  schema: { ...FULL_SCHEMA },
  signature: {
    error_type: "TypeError",
    error_message: "Cannot read properties of undefined",
    error_handling: "unhandled",
  },
  ...overrides,
});

describe("buildSignatureWhere", () => {
  it("pins rows to every present signature field", () => {
    const where = buildSignatureWhere(makeContext());

    expect(where).toBe(
      "type='error' AND error_type='TypeError' AND " +
        "error_message='Cannot read properties of undefined' AND error_handling='unhandled'",
    );
  });

  it("escapes single quotes in the message", () => {
    const ctx = makeContext({
      signature: { error_type: "TypeError", error_message: "can't read 'x'" },
    });

    expect(buildSignatureWhere(ctx)).toBe(
      "type='error' AND error_type='TypeError' AND error_message='can''t read ''x'''",
    );
  });

  it("skips fields the stream schema does not have", () => {
    const ctx = makeContext({ schema: { error_message: true } });

    expect(buildSignatureWhere(ctx)).toBe(
      "type='error' AND error_message='Cannot read properties of undefined'",
    );
  });

  it("returns null when only error_handling identifies the row", () => {
    const ctx = makeContext({
      signature: { error_handling: "unhandled" },
    });

    expect(buildSignatureWhere(ctx)).toBeNull();
  });

  it("returns null when the signature is entirely empty", () => {
    expect(buildSignatureWhere(makeContext({ signature: {} }))).toBeNull();
  });

  it("drops an oversized message rather than embedding it", () => {
    const ctx = makeContext({
      signature: { error_message: "x".repeat(MAX_SIGNATURE_MESSAGE_LEN + 1) },
    });

    expect(buildSignatureWhere(ctx)).toBeNull();
  });

  it("still identifies the issue by type when the message is oversized", () => {
    const ctx = makeContext({
      signature: {
        error_type: "TypeError",
        error_message: "x".repeat(MAX_SIGNATURE_MESSAGE_LEN + 1),
      },
    });

    expect(buildSignatureWhere(ctx)).toBe("type='error' AND error_type='TypeError'");
  });
});

describe("buildIssueImpactSql", () => {
  it("counts events, sessions, users and the issue lifespan", () => {
    const sql = buildIssueImpactSql(makeContext(), "type='error'");

    expect(sql).toBe(
      "SELECT COUNT(*) AS events, MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen, " +
        "COUNT(DISTINCT session_id) AS sessions_affected, COUNT(DISTINCT usr_id) AS users_affected " +
        "FROM \"_rumdata\" WHERE type='error'",
    );
  });

  it("omits the distinct counts when the stream carries neither column", () => {
    const ctx = makeContext({ schema: { error_message: true } });

    expect(buildIssueImpactSql(ctx, "type='error'")).toBe(
      "SELECT COUNT(*) AS events, MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen " +
        "FROM \"_rumdata\" WHERE type='error'",
    );
  });

  it("falls back to session_id for the user count when usr_id is absent", () => {
    const ctx = makeContext({ schema: { session_id: true } });

    expect(buildIssueImpactSql(ctx, "type='error'")).toContain(
      "COUNT(DISTINCT session_id) AS users_affected",
    );
  });
});

describe("buildIssueOccurrencesSql", () => {
  it("buckets the issue's events by the given interval", () => {
    const sql = buildIssueOccurrencesSql(makeContext(), "type='error'", "5 minute");

    expect(sql).toBe(
      "SELECT histogram(_timestamp, '5 minute') AS ts, COUNT(*) AS events" +
        " FROM \"_rumdata\" WHERE type='error' GROUP BY ts ORDER BY ts",
    );
  });
});

describe("availableFacets", () => {
  it("keeps only facets whose column exists in the schema", () => {
    const ctx = makeContext({ schema: { user_agent_os_family: true } });

    expect(availableFacets(ctx, FACET_GROUPS[0]).map((facet) => facet.key)).toEqual(["os"]);
  });

  it("returns an empty list when no facet column exists", () => {
    const ctx = makeContext({ schema: {} });

    expect(availableFacets(ctx, FACET_GROUPS[1])).toEqual([]);
  });

  it("groups the four dimensions into two low-cardinality searches", () => {
    expect(FACET_GROUPS.map((group) => group.map((facet) => facet.key))).toEqual([
      ["browser", "os"],
      ["release", "page"],
    ]);
  });
});

describe("buildFacetSql", () => {
  it("groups by every requested column", () => {
    const ctx = makeContext();

    expect(buildFacetSql(ctx, "type='error'", FACET_GROUPS[0])).toBe(
      "SELECT user_agent_user_agent_family, user_agent_os_family, COUNT(*) AS events" +
        " FROM \"_rumdata\" WHERE type='error'" +
        " GROUP BY user_agent_user_agent_family, user_agent_os_family ORDER BY events DESC",
    );
  });

  it("returns null when there is nothing to group by", () => {
    expect(buildFacetSql(makeContext(), "type='error'", [])).toBeNull();
  });
});

describe("buildBreadcrumbsSql", () => {
  it("scopes the trail to one session and orders it chronologically", () => {
    const sql = buildBreadcrumbsSql(makeContext(), "session-1");

    expect(sql).toBe(
      'SELECT * FROM "_rumdata"' +
        " WHERE session_id='session-1' AND type IN ('error', 'action', 'view', 'resource')" +
        " ORDER BY _timestamp",
    );
  });

  it("escapes quotes in the session id", () => {
    expect(buildBreadcrumbsSql(makeContext(), "a'b")).toContain("session_id='a''b'");
  });
});

describe("pivotFacet", () => {
  it("sums a dimension across the group-by cross product", () => {
    const hits = [
      { user_agent_user_agent_family: "Chrome", user_agent_os_family: "Mac", events: 6 },
      { user_agent_user_agent_family: "Chrome", user_agent_os_family: "Windows", events: 2 },
      { user_agent_user_agent_family: "Safari", user_agent_os_family: "Mac", events: 2 },
    ];

    expect(pivotFacet(hits, "user_agent_user_agent_family", "Unknown")).toEqual([
      { value: "Chrome", events: 8, share: 0.8 },
      { value: "Safari", events: 2, share: 0.2 },
    ]);
  });

  it("folds missing and empty values into a single unknown bucket", () => {
    const hits = [
      { version: null, events: 1 },
      { version: "", events: 1 },
      { version: "2.4.1", events: 8 },
    ];

    expect(pivotFacet(hits, "version", "Unknown")).toEqual([
      { value: "2.4.1", events: 8, share: 0.8 },
      { value: "Unknown", events: 2, share: 0.2 },
    ]);
  });

  it("caps the result at the requested top-N", () => {
    const hits = Array.from({ length: 8 }, (_, index) => ({
      version: `v${index}`,
      events: 8 - index,
    }));

    expect(pivotFacet(hits, "version", "Unknown", 3).map((entry) => entry.value)).toEqual([
      "v0",
      "v1",
      "v2",
    ]);
  });

  it("returns an empty list when nothing was counted", () => {
    expect(pivotFacet([{ version: "2.4.1", events: 0 }], "version", "Unknown")).toEqual([]);
  });

  it("returns an empty list for no hits at all", () => {
    expect(pivotFacet([], "version", "Unknown")).toEqual([]);
  });
});
