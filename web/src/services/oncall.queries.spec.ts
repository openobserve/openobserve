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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import {
  createOwnershipRuleMutation,
  deleteOwnershipRuleMutation,
  oncallTeamsQuery,
  pagedResponsesQuery,
  responsesQuery,
  routingConfigQuery,
  updateOwnershipRuleMutation,
} from "./oncall.queries";
import { oncallKeys } from "./oncall.querykeys";
import oncallService from "./oncall";

vi.mock("./oncall", () => ({
  RESPONSE_PAGE_LIMIT: 200,
  default: {
    listTeams: vi.fn().mockResolvedValue({ data: [{ id: "t1", name: "Payments" }] }),
    getRoutingConfig: vi.fn().mockResolvedValue({ data: { default_team_id: "t1" } }),
    listResponses: vi.fn().mockResolvedValue({ data: [{ id: "r1" }] }),
  },
}));

const ORG = "test-org";

describe("oncallTeamsQuery", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(oncallService.listTeams).mockClear();
  });

  it("is org-rooted so the org-switch purge reaches it", () => {
    expect(oncallTeamsQuery(ORG).queryKey).toEqual(oncallKeys.teams(ORG));
    expect(oncallTeamsQuery(ORG).queryKey.slice(0, 3)).toEqual(["org", ORG, "oncall"]);
  });

  it("serves every screen from one entry — nine consumers, one request", async () => {
    // The alert list, the incident drawer and the alert editor each ask independently.
    const [list, drawer, editor] = await Promise.all([
      queryClient.fetchQuery(oncallTeamsQuery(ORG)),
      queryClient.fetchQuery(oncallTeamsQuery(ORG)),
      queryClient.fetchQuery(oncallTeamsQuery(ORG)),
    ]);
    // A later screen, after the first three settled.
    const fourth = await queryClient.fetchQuery(oncallTeamsQuery(ORG));

    expect(oncallService.listTeams).toHaveBeenCalledTimes(1);
    expect(list).toEqual([{ id: "t1", name: "Payments" }]);
    expect(drawer).toEqual(list);
    expect(editor).toEqual(list);
    expect(fourth).toEqual(list);
  });

  it("keeps one org's teams out of another's entry", async () => {
    await queryClient.fetchQuery(oncallTeamsQuery(ORG));
    await queryClient.fetchQuery(oncallTeamsQuery("other-org"));
    expect(oncallService.listTeams).toHaveBeenCalledTimes(2);
  });

  it("unwraps to a list, so a team-less org is an empty array rather than undefined", async () => {
    vi.mocked(oncallService.listTeams).mockResolvedValueOnce({ data: undefined } as any);
    await expect(queryClient.fetchQuery(oncallTeamsQuery(ORG))).resolves.toEqual([]);
  });
});

describe("routingConfigQuery", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(oncallService.getRoutingConfig).mockClear();
  });

  it("shares one read across the card, the ownership table and the policy editor", async () => {
    await Promise.all([
      queryClient.fetchQuery(routingConfigQuery(ORG)),
      queryClient.fetchQuery(routingConfigQuery(ORG)),
      queryClient.fetchQuery(routingConfigQuery(ORG)),
    ]);
    expect(oncallService.getRoutingConfig).toHaveBeenCalledTimes(1);
  });

  it("reads null for an org that never nominated a catch-all", async () => {
    vi.mocked(oncallService.getRoutingConfig).mockResolvedValueOnce({ data: undefined } as any);
    await expect(queryClient.fetchQuery(routingConfigQuery(ORG))).resolves.toBeNull();
  });
});

describe("ownership rule writes", () => {
  /// A rule's "never matched" finding lives in its team's risk list, so a
  /// deleted rule kept warning from the team page for the risk tier.
  it.each([
    ["create", createOwnershipRuleMutation(ORG)],
    ["update", updateOwnershipRuleMutation(ORG)],
    ["delete", deleteOwnershipRuleMutation(ORG)],
  ])("expires every team's reads on %s", (_name, mutation) => {
    expect(mutation.meta?.invalidates).toContainEqual(oncallKeys.teamsAll(ORG));
  });
});

describe("the team page's pages and the Pages list", () => {
  // What the team page asks for, and what Pages asks for with that team picked.
  const FILTERS = { team_id: "t1", include_resolved: true };

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(oncallService.listResponses).mockClear();
  });

  it("keep separate entries, so neither is handed the other's shape", async () => {
    await queryClient.fetchQuery(responsesQuery(ORG, FILTERS));
    const walk = await queryClient.fetchQuery(pagedResponsesQuery(ORG, FILTERS));
    const list = await queryClient.fetchQuery(responsesQuery(ORG, FILTERS));

    expect(walk).toEqual({ rows: [{ id: "r1" }], truncated: false });
    expect(list).toEqual([{ id: "r1" }]);
    expect(oncallService.listResponses).toHaveBeenCalledTimes(2);
  });

  it("both expire with the scope a page write drops", async () => {
    await queryClient.fetchQuery(responsesQuery(ORG, FILTERS));
    await queryClient.fetchQuery(pagedResponsesQuery(ORG, FILTERS));

    await queryClient.invalidateQueries({
      queryKey: oncallKeys.responsesAll(ORG),
      refetchType: "none",
    });

    expect(queryClient.getQueryState(responsesQuery(ORG, FILTERS).queryKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(pagedResponsesQuery(ORG, FILTERS).queryKey)?.isInvalidated,
    ).toBe(true);
  });
});
