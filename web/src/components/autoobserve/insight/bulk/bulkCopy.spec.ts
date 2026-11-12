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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import config from "@/aws-exports";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { m12Rows, sourceRows } from "./bulkFixtures";
import {
  blockLine,
  failureLine,
  firesWhenOf,
  footerOf,
  groupMeta,
  groupTitle,
  needsThresholdLine,
  partialBanner,
  requestText,
  rightsBanner,
  ruleOf,
  serviceLabel,
  titleOf,
  toastOf,
  usuallyOf,
} from "./bulkCopy";
import { groupRows, reviewRowsOf, type FolderRef } from "./useBulkReview";

const t = i18n.global.t as unknown as TranslateFn;
const IDS = { ingest: "f-ingest", payments: "f-pay" };
const ingest: FolderRef = { id: "f-ingest", name: "ingest" };
const ops: FolderRef = { id: "f-ops", name: "ops" };
const original = config.isEnterprise;
const rowsOf = (rights: Record<string, boolean> | null = null) =>
  reviewRowsOf({ kind: "no_data", rows: m12Rows(IDS) }, { folders: [], overrides: {}, rights });

beforeEach(() => {
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = original;
});

describe("bulkCopy — header and footer", () => {
  it("titles one and many alerts", () => {
    expect(titleOf(t, "no_data", 12)).toBe("Add 12 no-data alerts");
    expect(titleOf(t, "no_data", 1)).toBe("Add 1 no-data alert");
    expect(t("insight.bulk.create")).toBe("Add alerts");
  });

  it("states the rule and that nothing is saved before Create", () => {
    expect(ruleOf(t, "no_data", rowsOf())).toBe(
      "Each fires when its service sends no rows for 15 min. Untick any you don't want. Nothing is saved until you click Add alerts.",
    );
  });

  it("says where the ticked alerts go, per folder", () => {
    expect(
      footerOf(t, "en-US", [
        { folder: ingest, count: 5 },
        { folder: ops, count: 3 },
      ]),
    ).toBe("8 alerts will be created: 5 in folder ingest, 3 in folder ops.");
    expect(footerOf(t, "en-US", [{ folder: ops, count: 1 }])).toBe(
      "1 alert will be created in folder ops.",
    );
    expect(footerOf(t, "en-US", [])).toBe("Nothing is ticked, so nothing will be created.");
  });

  it("summarises many folders after the first three", () => {
    const counts = ["a", "b", "c", "d", "e"].map((name, i) => ({
      folder: { id: name, name },
      count: 10 - i,
    }));
    expect(footerOf(t, "en-US", counts)).toBe(
      "40 alerts will be created: 10 in folder a, 9 in folder b, 8 in folder c, 13 in 2 more folders.",
    );
  });
});

describe("bulkCopy — rows and groups", () => {
  it("labels services by namespace only when the name repeats", () => {
    const rows = rowsOf();
    const label = (key: string) =>
      serviceLabel(
        t,
        rows.find((r) => r.key === key)!,
        rows,
      );
    expect(label("j")).toBe("svc-j");
    expect(label("a-none")).toBe("svc-a · no namespace");
    expect(label("a-b")).toBe("svc-a · ns-b");
    expect(label("e-b")).toBe("svc-e · ns-b");
  });

  it("names a service the way the coverage page does, even with no twin in the list (T2-N4)", () => {
    const scope = {
      service: "svc-b",
      label: "svc-b · no namespace",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "b" },
    };
    const rows = reviewRowsOf(
      {
        kind: "errors",
        rows: [
          { key: "b:errors", kind: "errors", scope, usually: 10 },
          { key: "b:no_data", kind: "no_data", scope, usually: null },
        ],
      },
      { folders: [], overrides: {}, rights: null },
    );
    expect(rows.map((r) => serviceLabel(t, r, rows))).toEqual([
      "svc-b · no namespace",
      "svc-b · no namespace",
    ]);
  });

  it("names twins as the coverage map does, adding the cluster only where it tells them apart (F-N4)", () => {
    const scope = (cluster: string) => ({
      service: "svc-y",
      cluster,
      namespace: "ns-g",
      stream: { type: "logs", name: "y" },
    });
    const rows = reviewRowsOf(
      {
        kind: "errors",
        rows: [
          { key: "y-e", kind: "errors", scope: scope("cluster-e"), usually: 10 },
          { key: "y-f", kind: "errors", scope: scope("cluster-f"), usually: 10 },
        ],
      },
      { folders: [], overrides: {}, rights: null },
    );
    expect(rows.map((r) => serviceLabel(t, r, rows))).toEqual([
      "svc-y · cluster-e · ns-g",
      "svc-y · cluster-f · ns-g",
    ]);
  });

  it("names a service plainly when its rows are only its own drafts of different kinds", () => {
    const scope = {
      service: "svc-x",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "x" },
    };
    const rows = reviewRowsOf(
      {
        kind: "errors",
        rows: [
          { key: "x:errors", kind: "errors", scope, usually: 10 },
          { key: "x:no_data", kind: "no_data", scope, usually: null },
        ],
      },
      { folders: [], overrides: {}, rights: null },
    );
    expect(rows.map((r) => serviceLabel(t, r, rows))).toEqual(["svc-x", "svc-x"]);
  });

  it("names each namespace in the no-usual-level reason (ADD-ALERT-DEST 9)", () => {
    const scope = (namespace: string) => ({
      service: "svc-a",
      cluster: null,
      namespace,
      stream: { type: "traces", name: "app_traces" },
      schema: ["service_name", "service_k8s_namespace_name"],
    });
    const rows = reviewRowsOf(
      {
        kind: "errors",
        rows: [
          { key: "j", kind: "errors", scope: scope("ns-j"), usually: null },
          { key: "s", kind: "errors", scope: scope("ns-s"), usually: null },
        ],
      },
      {
        folders: [],
        overrides: {},
        rights: null,
        baselines: { j: null, s: null },
        thresholds: { j: Number.NaN, s: Number.NaN },
      },
    );
    expect(rows.map((r) => blockLine(t, r, rows))).toEqual([
      "AutoObserve found no usual error count for svc-a · ns-j over the last 7 days. Set a threshold to add this alert.",
      "AutoObserve found no usual error count for svc-a · ns-s over the last 7 days. Set a threshold to add this alert.",
    ]);
  });

  it("says rows for logs and spans for traces, and the usual rate", () => {
    const rows = rowsOf();
    const ingestB = rows.find((r) => r.key === "ingest-b")!;
    const j = rows.find((r) => r.key === "j")!;
    expect(firesWhenOf(t, "no_data", ingestB)).toBe("no rows for 15 min");
    expect(firesWhenOf(t, "no_data", j)).toBe("no spans for 15 min");
    expect(usuallyOf(t, "en-US", ingestB)).toBe("2,400 an hour");
    const bursty = rows.find((r) => r.key === "a-none")!;
    expect(firesWhenOf(t, "no_data", bursty)).toBe("no rows for 3 hours");
  });

  it("fires a source row after an hour", () => {
    const rows = reviewRowsOf(
      { kind: "source", rows: sourceRows(2) },
      { folders: [], overrides: {}, rights: null },
    );
    expect(firesWhenOf(t, "source", rows[0])).toBe("no rows for 1 hour");
  });

  it("names how many alerts still need a threshold, one sentence for one or many", () => {
    expect(needsThresholdLine(t, 1)).toBe("1 alert needs a threshold before it can be added.");
    expect(needsThresholdLine(t, 12)).toBe("12 alerts need a threshold before they can be added.");
  });

  it("heads each group with its folder, destinations and tick count", () => {
    const groups = groupRows(rowsOf(), "team");
    const [ingestGroup, none] = groups;
    expect(groupTitle(t, ingestGroup)).toBe("Owner: ingest");
    expect(groupMeta(t, "en-US", ingestGroup, 5)).toEqual([
      "folder ingest",
      "notifies ingest-oncall",
      "5",
    ]);
    expect(groupTitle(t, none)).toBe("No owner yet");
    expect(groupMeta(t, "en-US", none, 3)).toEqual([
      "folder default (org default)",
      "notifies ops-webhook",
      "3 of 4 ticked",
    ]);
  });

  it("states partial rights up front and builds the request text", () => {
    const rows = rowsOf({ "f-pay": false });
    expect(rightsBanner(t, "en-US", rows)).toBe(
      "You can add 9 of 12. 3 are in folder payments, where you can't write. They stay in the list so you can send the request to its admins.",
    );
    expect(rightsBanner(t, "en-US", rowsOf())).toBeNull();
    const pay = groupRows(rows, "team").at(-1)!;
    expect(requestText(t, "en-US", pay, rows)).toBe(
      "Please add 3 no-data alerts in folder payments: svc-j, svc-e · ns-b, and svc-e · ns-c. AutoObserve found that nothing alerts if they stop sending.",
    );
  });
});

describe("bulkCopy — results", () => {
  it("reports a partial failure with one reason per row", () => {
    expect(partialBanner(t, 1, 8)).toBe("1 of 8 alerts wasn't created.");
    expect(partialBanner(t, 2, 8)).toBe("2 of 8 alerts weren't created.");
    expect(failureLine(t, "svc-j", { code: "forbidden", folder: "payments" })).toBe(
      "svc-j: You can't create alerts. Your role is missing the Create permission on Alerts. The alert was going to folder payments.",
    );
    expect(
      failureLine(t, "svc-a · ns-j", {
        code: "duplicate",
        name: "svc-a-ns-j-no-data",
        folder: "ops",
      }),
    ).toBe("svc-a · ns-j: an alert named svc-a-ns-j-no-data already exists in folder ops.");
    expect(failureLine(t, "svc-ingest-f", { code: "timeout" })).toBe(
      "svc-ingest-f: the server didn't answer in time.",
    );
  });

  it("says in the toast where the alerts went and until when Undo works", () => {
    expect(toastOf(t, "en-US", [ingest, ops], 8)).toBe(
      "8 alerts created in folders ingest and ops. Undo works until you leave this page.",
    );
    expect(toastOf(t, "en-US", [ingest], 1)).toBe(
      "1 alert created in folder ingest. Undo works until you leave this page.",
    );
  });

  it("states no one rule for a list that mixes kinds, since each row says when it fires", () => {
    const rows = rowsOf();
    const mixed = rows.map((r, i) =>
      i === 0 ? { ...r, row: { ...r.row, kind: "errors" as const } } : r,
    );
    expect(ruleOf(t, "no_data", mixed)).toBe(
      "Untick any you don't want. Nothing is saved until you click Add alerts.",
    );
  });

  it("puts no raw ids or keys in any sentence", () => {
    const rows = rowsOf({ "f-pay": false });
    const groups = groupRows(rows, "team");
    const sentences = [
      ruleOf(t, "no_data", rows),
      rightsBanner(t, "en-US", rows) ?? "",
      ...groups.flatMap((g) => [groupTitle(t, g), ...groupMeta(t, "en-US", g, 0)]),
      ...rows.map((r) => serviceLabel(t, r, rows)),
    ].join("\n");
    expect(sentences).not.toMatch(/f-ingest|f-pay|__no_team__|team:|insight\.bulk|no_data/);
  });
});
