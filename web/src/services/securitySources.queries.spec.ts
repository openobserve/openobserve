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

import { describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/vue-query";
import type { SecuritySetting, SourceListing, SourceRow } from "./securitySources";

const { client, attach } = vi.hoisted(() => ({
  client: { current: null as any },
  attach: vi.fn(),
}));
vi.mock("@/composables/query/queryClient", () => ({
  get queryClient() {
    return client.current;
  },
}));
vi.mock("./securitySources", () => ({ default: { attach } }));

import {
  attachPackMutation,
  securitySourceKeys,
  withAttachedSetting,
} from "./securitySources.queries";

const row = (name: string, extra: Partial<SourceRow> = {}): SourceRow =>
  ({
    name,
    state: "included",
    reason: "classifier",
    suggested: false,
    verdict: null,
    source_type: "",
    offered_pack: { id: "crowdstrike_fdr", version: 1, label: "CrowdStrike FDR" },
    detach_pack: null,
    health: "live",
    activity: { doc_num: 1, doc_time_max: 1 },
    included: true,
    updated_by: "",
    updated_at: 0,
    last_change: null,
    setting: null,
    ...extra,
  }) as SourceRow;

const setting = {
  source_type: "edr",
  pack_id: "crowdstrike_fdr",
  pack_version: 1,
  attached_at: 1,
  pipeline_id: "p1",
  pipeline_created: true,
} as SecuritySetting;

const listing = (): SourceListing => ({
  streams: [row("edr"), row("okta")],
  sources: ["okta"],
  suggestions: [],
  notices: [],
});

describe("withAttachedSetting", () => {
  it("lists the attached stream as mapped with its pack, leaving the others alone", () => {
    const before = listing();
    const after = withAttachedSetting(before, "edr", setting)!;
    const edr = after.streams[0];
    expect(edr.state).toBe("mapped");
    expect(edr.setting).toBe(setting);
    expect(edr.source_type).toBe("edr");
    expect(edr.detach_pack).toEqual({
      id: "crowdstrike_fdr",
      version: 1,
      label: "CrowdStrike FDR",
    });
    expect(after.streams[1]).toBe(before.streams[1]);
    expect(after.sources).toEqual(["okta", "edr"]);
  });

  it("leaves an unloaded list unloaded", () => {
    expect(withAttachedSetting(undefined, "edr", setting)).toBeUndefined();
  });
});

describe("attachPackMutation", () => {
  it("moves the row to mapped in the cached list as soon as the server answers", async () => {
    client.current = new QueryClient();
    client.current.setQueryData(securitySourceKeys.list("org"), listing());
    attach.mockResolvedValue({ data: { setting, pipeline_created: true } });
    const observer = new MutationObserver(client.current, attachPackMutation("org"));
    await observer.mutate({ stream: "edr", packId: "crowdstrike_fdr", packVersion: 1 });
    const cached = client.current.getQueryData(securitySourceKeys.list("org")) as SourceListing;
    expect(cached.streams[0].state).toBe("mapped");
  });
});
