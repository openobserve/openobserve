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

import type { AlertLibraryEntry } from "@/types/alertLibrary";

import { groupFindMore } from "./findMore";
import type { PackInstallRecord, StarterPack } from "./types";

type FindMoreInputs = Parameters<typeof groupFindMore>[0];

const entry = (id: string, pack: string, stream: string): AlertLibraryEntry =>
  ({ id, pack, title: `Title ${id}`, required_streams: [stream] }) as AlertLibraryEntry;

const PACK = {
  id: "kubernetes",
  dashboards: [{ id: "overview", title: "Overview", load: async () => ({}) }],
  alerts: ["k8s/one", "k8s/two"],
  savedViews: [
    { id: "events", name: "Events", search: {} },
    { id: "audit", name: "Audit", search: {} },
  ],
} as unknown as StarterPack;

const inputs = (overrides: Partial<FindMoreInputs> = {}): FindMoreInputs => {
  const catalog = new Map(
    [entry("k8s/one", "k8s", "kube"), entry("k8s/two", "k8s", "kube")].map((row) => [row.id, row]),
  );
  return {
    packs: [
      {
        pack: PACK,
        match: {
          alerts: new Map([
            ["k8s/one", true],
            ["k8s/two", false],
          ]),
          dashboards: new Map([["overview", true]]),
          views: new Map([
            ["events", true],
            ["audit", false],
          ]),
          ready: true,
        },
        fits: ["kube_pod_status_phase"],
        records: [],
      },
    ],
    catalog,
    nowUs: 42,
    ...overrides,
  };
};

const record = (items: PackInstallRecord["items"], status = "complete"): PackInstallRecord =>
  ({ packId: "kubernetes", installId: "i", status, items }) as PackInstallRecord;

describe("groupFindMore", () => {
  it("groups ready items by source and leaves out what has no fresh data", () => {
    const result = groupFindMore(inputs());
    expect(result.checkedAt).toBe(42);
    expect(result.sources.map(({ id }) => id)).toEqual(["kubernetes"]);
    expect(result.sources[0].items).toEqual([
      { kind: "dashboard", id: "overview", name: "Overview" },
      { kind: "alert", id: "k8s/one", name: "Title k8s/one" },
      { kind: "savedView", id: "events", name: "Events" },
    ]);
  });

  it("names a pack's detection streams, not its alerts' streams", () => {
    const [pack] = groupFindMore(inputs()).sources;
    expect(pack.streams).toEqual(["kube_pod_status_phase"]);
  });

  it("leaves out a pack Home would not offer: a saved view alone, or no detected stream", () => {
    const [row] = inputs().packs;
    const viewOnly = { ...row.match, ready: false };
    const unseen = { ...row, pack: { ...PACK, detector: undefined }, fits: [] };
    const ids = (packs: FindMoreInputs["packs"]) =>
      groupFindMore(inputs({ packs })).sources.map(({ id }) => id);
    expect(ids([{ ...row, match: viewOnly }])).toEqual([]);
    expect(ids([unseen])).toEqual([]);
    expect(ids([{ ...unseen, pack: { ...PACK, detector: "kubernetes" } as StarterPack }])).toEqual([
      "kubernetes",
    ]);
  });

  it("leaves out items an install record already holds", () => {
    const result = groupFindMore(
      inputs({
        packs: [
          {
            ...inputs().packs[0],
            records: [record([{ kind: "dashboard", itemId: "overview", status: "created" }])],
          },
        ],
      }),
    );
    expect(result.sources[0].items.map(({ id }) => id)).toEqual(["k8s/one", "events"]);
  });

  it("offers items of a removed install again", () => {
    const removed = record(
      [{ kind: "dashboard", itemId: "overview", status: "created" }],
      "removed",
    );
    const result = groupFindMore(inputs({ packs: [{ ...inputs().packs[0], records: [removed] }] }));
    expect(result.sources[0].items.map(({ id }) => id)).toContain("overview");
  });

  it("answers with no sources when nothing new fits", () => {
    const none = new Map<string, boolean>();
    const result = groupFindMore(
      inputs({
        packs: [
          {
            pack: PACK,
            match: { alerts: none, dashboards: none, views: none, ready: false },
            fits: [],
            records: [],
          },
        ],
      }),
    );
    expect(result.sources).toEqual([]);
  });
});
