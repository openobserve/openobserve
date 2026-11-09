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

import {
  NO_DISMISSALS,
  groupFindMore,
  itemKey,
  libraryPack,
  parseDismissals,
  parseResult,
  type FindMoreInputs,
} from "./findMore";
import type { PackInstallRecord, StarterPack } from "./types";

const entry = (id: string, pack: string, stream: string): AlertLibraryEntry =>
  ({ id, pack, title: `Title ${id}`, required_streams: [stream] }) as AlertLibraryEntry;

const PACK = {
  id: "kubernetes",
  dashboards: [{ id: "overview", title: "Overview", load: async () => ({}) }],
  alerts: ["k8s/one", "k8s/two"],
  savedViews: [],
} as unknown as StarterPack;

const NGINX = [entry("nginx/5xx", "nginx", "edge"), entry("nginx/slow", "nginx", "edge")];
const PG = [entry("pg/locks", "postgres", "pg_metrics")];

const inputs = (overrides: Partial<FindMoreInputs> = {}): FindMoreInputs => {
  const catalog = new Map(
    [entry("k8s/one", "k8s", "kube"), entry("k8s/two", "k8s", "kube"), ...NGINX, ...PG].map(
      (row) => [row.id, row],
    ),
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
          ready: true,
        },
        records: [],
      },
    ],
    catalog,
    library: {
      entries: [...NGINX, ...PG],
      verdicts: new Map([
        ["nginx/5xx", true],
        ["nginx/slow", true],
        ["pg/locks", false],
      ]),
    },
    installedLibraryIds: new Set(),
    dismissals: NO_DISMISSALS,
    queriesOf: () => 288,
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
    expect(result.sources.map(({ id }) => id)).toEqual(["kubernetes", "library-nginx"]);
    const [pack, nginx] = result.sources;
    expect(pack.items).toEqual([
      { kind: "dashboard", id: "overview", name: "Overview", queries: 0 },
      { kind: "alert", id: "k8s/one", name: "Title k8s/one", queries: 288 },
    ]);
    expect(nginx.items.map(({ id }) => id)).toEqual(["nginx/5xx", "nginx/slow"]);
    expect(nginx.streams).toEqual(["edge"]);
    expect(nginx.queriesPerDay).toBe(576);
  });

  it("leaves out items an install record or a Library install already holds", () => {
    const result = groupFindMore(
      inputs({
        packs: [
          {
            ...inputs().packs[0],
            records: [record([{ kind: "dashboard", itemId: "overview", status: "created" }])],
          },
        ],
        installedLibraryIds: new Set(["k8s/one", "nginx/5xx"]),
      }),
    );
    expect(result.sources.map(({ id }) => id)).toEqual(["library-nginx"]);
    expect(result.sources[0].items.map(({ id }) => id)).toEqual(["nginx/slow"]);
  });

  it("offers items of a removed install again", () => {
    const removed = record(
      [{ kind: "dashboard", itemId: "overview", status: "created" }],
      "removed",
    );
    const result = groupFindMore(inputs({ packs: [{ ...inputs().packs[0], records: [removed] }] }));
    expect(result.sources[0].items.map(({ id }) => id)).toContain("overview");
  });

  it("leaves out dismissed sources and items and counts them", () => {
    const result = groupFindMore(
      inputs({
        dismissals: { sources: ["library-nginx"], items: [itemKey("kubernetes", "overview")] },
      }),
    );
    expect(result.sources.map(({ id }) => id)).toEqual(["kubernetes"]);
    expect(result.sources[0].items.map(({ id }) => id)).toEqual(["k8s/one"]);
    expect(result.dismissed).toBe(3);
  });

  it("answers with no sources when nothing new fits", () => {
    const none = new Map<string, boolean>();
    const result = groupFindMore(
      inputs({
        packs: [
          { pack: PACK, match: { alerts: none, dashboards: none, ready: false }, records: [] },
        ],
        library: { entries: [], verdicts: none },
      }),
    );
    expect(result.sources).toEqual([]);
    expect(result.dismissed).toBe(0);
  });
});

describe("libraryPack", () => {
  it("installs a Library group as alerts only, under its own record prefix", () => {
    const pack = libraryPack("nginx", NGINX);
    expect(pack.id).toBe("library-nginx");
    expect(pack.alerts).toEqual(["nginx/5xx", "nginx/slow"]);
    expect(pack.dashboards).toEqual([]);
    expect(pack.savedViews).toEqual([]);
  });
});

describe("stored values", () => {
  it("reads a malformed dismissal list as none", () => {
    expect(parseDismissals("{")).toEqual(NO_DISMISSALS);
    expect(parseDismissals(JSON.stringify({ sources: ["a", 3], items: "x" }))).toEqual({
      sources: ["a"],
      items: [],
    });
  });

  it("reads a malformed last check as missing", () => {
    expect(parseResult(null)).toBeNull();
    expect(parseResult(JSON.stringify({ checkedAt: "now", sources: [] }))).toBeNull();
    expect(parseResult(JSON.stringify({ checkedAt: 1, sources: [] }))).toEqual({
      checkedAt: 1,
      sources: [],
      dismissed: 0,
    });
  });
});
