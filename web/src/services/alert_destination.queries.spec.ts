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

import { describe, it, expect, vi } from "vitest";
import { destinationsQuery } from "./alert_destination.queries";

vi.mock("./alert_destination", () => ({
  default: {
    list: vi.fn().mockResolvedValue({
      data: [
        { name: "slack-ops", destination_type_name: "slack" },
        { name: "jira-ops", destination_type_name: "jira" },
        { name: "webhook", destination_type_name: "" },
      ],
    }),
  },
}));

const ORG = "test-org";
const names = async (options: ReturnType<typeof destinationsQuery>) =>
  ((await (options.queryFn as any)()) as { name: string }[]).map((d) => d.name);

describe("destinationsQuery excludeTypes", () => {
  it("drops the excluded destination types", async () => {
    expect(await names(destinationsQuery(ORG, "alert", false, ["jira"]))).toEqual([
      "slack-ops",
      "webhook",
    ]);
  });

  it("returns every destination without it", async () => {
    expect(await names(destinationsQuery(ORG, "alert"))).toEqual([
      "slack-ops",
      "jira-ops",
      "webhook",
    ]);
  });

  it("keeps a filtered list in its own cache entry and leaves the plain key unchanged", () => {
    const plain = destinationsQuery(ORG, "alert").queryKey;
    expect(destinationsQuery(ORG, "alert", false, ["jira"]).queryKey).not.toEqual(plain);
    expect(destinationsQuery(ORG, "alert", false, []).queryKey).toEqual(plain);
    expect(plain).toEqual(["org", ORG, "alerts", "destinations", "alert", "plain"]);
  });
});
