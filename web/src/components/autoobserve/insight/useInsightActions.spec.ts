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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { InsightCta } from "./insightCopy";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const org = vi.hoisted(() => ({ value: "demo-org" }));
vi.mock("@/composables/query", () => ({ useOrgId: () => org }));
const requestAlertCreation = vi.fn();
vi.mock("@/composables/alerts/useAlertCreation", () => ({
  requestAlertCreation: (...a: unknown[]) => requestAlertCreation(...a),
}));
const readStreamFields = vi.fn();
const openBulkReview = vi.fn();
const loadReviewContext = vi.fn(async () => undefined);
vi.mock("./bulk/useBulkReview", () => ({
  openBulkReview: (...a: unknown[]) => openBulkReview(...a),
  loadReviewContext: (...a: unknown[]) => loadReviewContext(...a),
  readStreamFields: (...a: unknown[]) => readStreamFields(...a),
}));
const openAlertReview = vi.fn();
const measureBaseline = vi.fn();
vi.mock("./targets/baseline", () => ({
  measureBaseline: (...a: unknown[]) => measureBaseline(...a),
}));
vi.mock("@/components/alert_calibration/reviewAlert", () => ({
  openAlertReview: (...a: unknown[]) => openAlertReview(...a),
}));
const destinationHandoff = vi.fn(async () => ({ name: "editAlert", query: { id: "a-9" } }));
vi.mock("./targets/editTargets", () => ({
  destinationHandoff: (...a: unknown[]) => destinationHandoff(...a),
}));

const { useInsightActions } = await import("./useInsightActions");

const run = (cta: InsightCta) => {
  let actions!: ReturnType<typeof useInsightActions>;
  mount(
    defineComponent({
      setup() {
        actions = useInsightActions();
        return () => h("div");
      },
    }),
  );
  return actions.run("f1", cta);
};

const prefill = { streamName: "ingest_c", warnings: [] } as unknown as AlertPrefill;

beforeEach(() => {
  org.value = "demo-org";
  measureBaseline.mockReset();
  push.mockReset();
  requestAlertCreation.mockReset();
  openBulkReview.mockReset();
  loadReviewContext.mockClear();
});

describe("useInsightActions: a direct Add alert reads its stream's fields first (F2)", () => {
  const scope = {
    service: "svc-a",
    cluster: null,
    namespace: "ns-1",
    stream: { type: "logs", name: "app_logs" },
  };
  const draftCta = (): InsightCta => ({
    key: "addAlert",
    action: "addAlert",
    label: raw("Add alert"),
    note: null,
    target: {
      type: "create_alert",
      prefill,
      folder: "default",
      draft: {
        scope,
        build: (s) => ({ streamName: "app_logs", sql: JSON.stringify(s), warnings: [] }) as never,
      },
    },
  });

  it("builds on the schema, so an app-named service and its namespace are filtered right", async () => {
    readStreamFields.mockResolvedValueOnce({
      names: ["app", "k8s_namespace_name"],
      types: { app: "Utf8" },
    });
    await run(draftCta());
    expect(readStreamFields).toHaveBeenCalledWith("demo-org", scope.stream);
    const built = requestAlertCreation.mock.calls[0][0] as AlertPrefill;
    expect(JSON.parse(built.sql!)).toMatchObject({
      schema: ["app", "k8s_namespace_name"],
      fieldTypes: { app: "Utf8" },
    });
    expect(requestAlertCreation.mock.calls[0][1]).toEqual({ folder: "default" });
  });

  it("blocks Save with a red reason when the fields can't be read", async () => {
    readStreamFields.mockResolvedValueOnce(null);
    await run(draftCta());
    const built = requestAlertCreation.mock.calls[0][0] as AlertPrefill;
    expect(built.warnings).toContainEqual(
      expect.objectContaining({ key: "autoobserve.schemaUnread", level: "blocking" }),
    );
  });
});

describe("useInsightActions: an answer from another org is dropped (F11)", () => {
  const scope = {
    service: "svc-a",
    cluster: null,
    namespace: null,
    stream: { type: "logs", name: "app_logs" },
  };
  const pending = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("never opens a draft whose fields arrive after the org changed", async () => {
    const fields = pending<{ names: string[]; types: Record<string, string> }>();
    readStreamFields.mockReturnValueOnce(fields.promise);
    const done = run({
      key: "addAlert",
      action: "addAlert",
      label: raw("Add alert"),
      note: null,
      target: {
        type: "create_alert",
        prefill,
        folder: "f-a",
        draft: { scope, build: () => prefill },
      },
    });
    org.value = "other-org";
    fields.resolve({ names: ["service_name"], types: {} });
    await done;
    expect(requestAlertCreation).not.toHaveBeenCalled();
  });

  it("never follows a destinations handoff that lands after the org changed", async () => {
    const route = pending<{ name: string }>();
    destinationHandoff.mockReturnValueOnce(route.promise as never);
    const done = run({
      key: "who",
      action: "chooseWhoGetsNotified",
      label: raw("Choose who gets notified"),
      note: null,
      target: { type: "destinations", alertId: "a-9", alertName: "probe", destinations: [] },
    });
    org.value = "other-org";
    route.resolve({ name: "editAlert" });
    await done;
    expect(push).not.toHaveBeenCalled();
  });

  it("tells the alert review its answer is stale once the org changed", async () => {
    await run({
      key: "review",
      action: "reviewAlert",
      label: raw("Review alert"),
      note: null,
      target: {
        type: "review_alert",
        action: { type: "review_alert", alert_id: "a-1", focus: "query" },
        alertName: "probe",
        findingId: "f1",
      },
    } as InsightCta);
    const current = openAlertReview.mock.calls[0][4] as () => boolean;
    expect(current()).toBe(true);
    org.value = "other-org";
    expect(current()).toBe(false);
  });
});

describe("useInsightActions: a threshold is measured, else asked for (F1)", () => {
  const scope = {
    service: "svc-b",
    cluster: null,
    namespace: null,
    stream: { type: "traces", name: "app_traces" },
  };
  const build = vi.fn(
    (_s: unknown, level?: { usual?: number | null; threshold?: number | null }) =>
      ({
        streamName: "app_traces",
        sql: JSON.stringify(level ?? {}),
        warnings: [],
      }) as unknown as AlertPrefill,
  );
  const measured = (): InsightCta => ({
    key: "addAlert",
    action: "addAlert",
    label: raw("Add alert"),
    note: null,
    target: {
      type: "create_alert",
      prefill,
      folder: "default",
      draft: {
        scope,
        build,
        measure: () => ({ kind: "latency", stream: scope.stream, sql: "SELECT 1" }),
      },
    },
  });

  it("measures the usual level once the fields are read, and drafts on it", async () => {
    readStreamFields.mockResolvedValueOnce({ names: ["service_name", "duration"], types: {} });
    measureBaseline.mockResolvedValueOnce(250);
    await run(measured());
    expect(measureBaseline).toHaveBeenCalledWith("demo-org", {
      kind: "latency",
      stream: scope.stream,
      sql: "SELECT 1",
    });
    const built = requestAlertCreation.mock.calls[0][0] as AlertPrefill;
    expect(JSON.parse(built.sql!)).toEqual({ usual: 250, threshold: null });
  });

  it("hands the dialog a rebuild that takes the threshold the user types", async () => {
    readStreamFields.mockResolvedValueOnce({ names: ["service_name", "duration"], types: {} });
    measureBaseline.mockResolvedValueOnce(null);
    await run(measured());
    const rebuild = requestAlertCreation.mock.calls[0][2] as (o: {
      threshold?: number;
    }) => AlertPrefill;
    expect(JSON.parse(rebuild({ threshold: 400 }).sql!)).toEqual({ usual: null, threshold: 400 });
  });

  it("measures nothing for a draft that needs no usual level", async () => {
    readStreamFields.mockResolvedValueOnce({ names: ["service_name"], types: {} });
    await run({
      ...measured(),
      target: { ...(measured().target as any), draft: { scope, build } },
    });
    expect(measureBaseline).not.toHaveBeenCalled();
  });
});

describe("useInsightActions: where each fix lands", () => {
  it("opens the alert editor at its destinations for Choose who gets notified", async () => {
    await run({
      key: "who",
      action: "chooseWhoGetsNotified",
      label: raw("Choose who gets notified"),
      note: null,
      target: { type: "destinations", alertId: "a-9", alertName: "probe", destinations: [] },
    });
    expect(destinationHandoff).toHaveBeenCalledWith("a-9", [], {
      alertName: "probe",
      isCurrent: expect.any(Function),
    });
    expect(push).toHaveBeenCalledWith({ name: "editAlert", query: { id: "a-9" } });
  });

  it("opens the Add alert dialog with the prefill and its folder", async () => {
    await run({
      key: "addAlert",
      action: "addAlert",
      label: raw("Add alert"),
      note: null,
      target: { type: "create_alert", prefill, folder: "default" },
    });
    expect(requestAlertCreation).toHaveBeenCalledWith(prefill, { folder: "default" });
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the review list and loads its folders and fields", async () => {
    const request = { kind: "no_data" as const, rows: [] };
    await run({
      key: "bulk",
      action: "reviewAndAddAlerts",
      label: raw("Review and add alerts"),
      note: null,
      target: { type: "bulk", request },
    });
    expect(openBulkReview).toHaveBeenCalledWith(request);
    expect(loadReviewContext).toHaveBeenCalledWith("demo-org");
  });

  it("does nothing for a locked fix", async () => {
    await run({
      key: "addAlert",
      action: "addAlert",
      label: raw("Add alert"),
      note: null,
      locked: raw("You can't add alerts in folder default."),
      target: { type: "create_alert", prefill, folder: "default" },
    });
    expect(requestAlertCreation).not.toHaveBeenCalled();
  });

  it("pushes a plain route", async () => {
    await run({
      key: "logs",
      action: "openInLogs",
      label: raw("Open in Logs"),
      note: null,
      target: { type: "route", to: { path: "/logs" } },
    });
    expect(push).toHaveBeenCalledWith({ path: "/logs" });
  });
});

describe("useInsightActions: Review change opens its dialog (W5)", () => {
  it("holds the change for the dialog and opens it, writing nothing", async () => {
    let actions!: ReturnType<typeof useInsightActions>;
    mount(
      defineComponent({
        setup() {
          actions = useInsightActions();
          return () => h("div");
        },
      }),
    );
    const change = {
      findingId: "f-1",
      alertId: "a-1",
      alertName: "disk latency",
      action: {
        type: "apply_suggestion" as const,
        alert_id: "a-1",
        patch: [{ field: "pending_period_secs" as const, from: 0, to: 120 }],
      },
    };
    await actions.run("f1", {
      key: "review-change",
      action: "reviewChange",
      label: raw("Review change"),
      note: null,
      target: { type: "review_change", change },
    });
    expect(actions.reviewOpen.value).toBe(true);
    expect(actions.reviewTarget.value).toEqual(change);
    expect(push).not.toHaveBeenCalled();
  });
});
