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

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import streamService from "@/services/stream";
import destinationService from "@/services/alert_destination";
import alertsService from "@/services/alerts";
import {
  authorOnly,
  cloudtrailEvent,
  makeSecurityRouter,
  okResponse,
  triageOnly,
} from "@/views/Security/__fixtures__/securityFixtures";

vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn(), schema: vi.fn() } }));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/alerts", () => ({ default: { create_by_alert_id: vi.fn() } }));
vi.mock("@/services/securitySigma", async () =>
  (await import("@/views/Security/__fixtures__/sigmaFixtures")).mockSigmaService(),
);
vi.mock("@/services/securitySources.queries", async () =>
  (await import("@/views/Security/__fixtures__/securityFixtures")).sourceQueriesModule(),
);
vi.mock("@/utils/security/detectionFolder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/security/detectionFolder")>()),
  detectionFolderId: vi.fn(async () => "security-folder"),
}));
vi.mock("@/composables/security/useDetectionPreview", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/security/useDetectionPreview")>();
  return {
    ...actual,
    useDetectionPreview: () => ({ ...actual.useDetectionPreview(), validate: async () => null }),
  };
});
vi.mock("@/composables/security/useSecurityAccess", async () => {
  const f = await import("@/views/Security/__fixtures__/securityFixtures");
  return { useSecurityAccess: f.mockSecurityAccess };
});
vi.mock("@/lib/overlay/Dialog/ODialog.vue", () => ({
  default: {
    name: "ODialog",
    props: ["open", "primaryButtonDisabled"],
    template: `<div v-if="open" class="o-dialog-stub"><slot /></div>`,
  },
}));

import SecurityNewDetectionDialog from "./SecurityNewDetectionDialog.vue";

let wrapper: VueWrapper | null = null;

const mountDialog = async (preset: Record<string, string> | null = null) => {
  const router = await makeSecurityRouter("/security/detections");
  wrapper = mount(SecurityNewDetectionDialog, {
    props: { open: true, orgId: "default", preset },
    global: { provide: { store }, plugins: [store, router], stubs: { CodeQueryEditor: true } },
  });
  await flushPromises();
  return wrapper;
};

// The form validates asynchronously, so a submit lands after more than one flush.
const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalled());
  await flushPromises();
};

beforeEach(() => {
  vi.mocked(streamService.nameList).mockResolvedValue(okResponse({ list: [] }) as never);
  vi.mocked(destinationService.list).mockResolvedValue(okResponse({ list: [] }) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityNewDetectionDialog access", () => {
  it("stays closed and loads nothing for a user who cannot author detections", async () => {
    triageOnly();
    const w = await mountDialog();
    expect(w.findComponent({ name: "ODialog" }).props("open")).toBe(false);
    expect(streamService.nameList).not.toHaveBeenCalled();
  });

  it("opens for an author", async () => {
    authorOnly();
    const w = await mountDialog();
    expect(w.findComponent({ name: "ODialog" }).props("open")).toBe(true);
    expect(streamService.nameList).toHaveBeenCalled();
  });
});

describe("SecurityNewDetectionDialog destinations", () => {
  it("treats no destinations as information, not a blocker", async () => {
    authorOnly();
    const w = await mountDialog();
    const banner = w.findComponent('[data-test="security-detections-new-no-destination"]');
    expect(banner.exists()).toBe(true);
    expect(banner.props("variant")).toBe("info");
  });

  it("leaves the destination empty even when only one exists", async () => {
    authorOnly();
    vi.mocked(destinationService.list).mockResolvedValue(
      okResponse({ list: [{ name: "soc-slack" }] }) as never,
    );
    const w = await mountDialog();
    const select = w.findComponent('[data-test="security-detections-new-destinations"]');
    expect(select.props("modelValue")).toEqual([]);
  });

  it("saves a detection with no destination, and it still opens cases", async () => {
    authorOnly();
    // jsdom has no CSS.escape, which the dialog uses to scroll the preset rule into view.
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
    vi.mocked(streamService.schema).mockResolvedValue(
      okResponse({
        schema: Object.keys(cloudtrailEvent()).map((name) => ({ name, type: "Utf8" })),
      }) as never,
    );
    vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(okResponse({}) as never);
    const w = await mountDialog({
      sigmaId: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
      stream: "aws_cloudtrail",
      source: "aws_cloudtrail",
    });
    const dialog = w.findComponent({ name: "ODialog" });
    expect(dialog.props("primaryButtonDisabled")).toBe(false);
    await submit(w);
    await flushPromises();
    const [, payload] = vi.mocked(alertsService.create_by_alert_id).mock.calls[0] as unknown as [
      string,
      { destinations: string[]; creates_incident: boolean },
    ];
    expect(payload.destinations).toEqual([]);
    expect(payload.creates_incident).toBe(true);
    expect(w.emitted("created")).toBeTruthy();
  });
});

describe("SecurityNewDetectionDialog correlations", () => {
  it("installs a correlation from Content as a grouped detection over its timespan", async () => {
    authorOnly();
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
    const columns = [
      "_timestamp",
      "eventtype",
      "outcome_result",
      "actor_alternateid",
      "client_geographicalcontext_country",
    ];
    vi.mocked(streamService.schema).mockResolvedValue(
      okResponse({ schema: columns.map((name) => ({ name, type: "Utf8" })) }) as never,
    );
    vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(okResponse({}) as never);
    const w = await mountDialog({
      sigmaId: "01932551-8222-400e-8529-a9e1c31d8447",
      stream: "okta_auth",
      source: "okta_system_log",
    });
    const window = w.find('[data-test="security-detections-new-correlation-window"] input');
    expect((window.element as HTMLInputElement).value).toBe("60");
    expect(window.attributes("readonly")).toBeDefined();
    // The SQL sits outside the banner, whose flex row cannot shrink below a long line.
    expect(w.find('[data-test="security-detections-new-compiled-sql"]').text()).toContain(
      "GROUP BY",
    );
    expect(w.find('[data-test="security-detections-new-compile"]').text()).not.toContain(
      "GROUP BY",
    );
    const period = w.findComponent('[data-test="security-detections-new-period"]');
    expect(period.props("disabled")).toBeFalsy();
    const periodInput = period.find("input");
    expect((periodInput.element as HTMLInputElement).value).toBe("60");
    const dialog = w.findComponent({ name: "ODialog" });
    expect(dialog.props("primaryButtonDisabled")).toBe(false);

    await periodInput.setValue("30");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    expect(w.text()).toContain("Must be at least the 60-minute correlation window");

    await periodInput.setValue("120");
    await w
      .find('[data-test="security-detections-new-backfill"] [role="checkbox"]')
      .trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-detections-new-backfill-range"]').exists()).toBe(true);
    await submit(w);
    await flushPromises();
    const [, payload] = vi.mocked(alertsService.create_by_alert_id).mock.calls[0] as unknown as [
      string,
      {
        query_condition: { sql: string };
        trigger_condition: { period: number; frequency: number };
        context_attributes: Record<string, string>;
      },
    ];
    expect(payload.query_condition.sql).toMatch(/GROUP BY "actor_alternateid" HAVING/);
    expect(payload.trigger_condition.period).toBe(120);
    expect(payload.trigger_condition.frequency).toBe(15);
    expect(payload.context_attributes.siem_group_by).toBe("actor_alternateid");
    expect(payload.context_attributes.siem_timespan_minutes).toBe("60");
    expect(payload.context_attributes.siem_backfill_minutes).toBe("1440");
  });
});

describe("SecurityNewDetectionDialog correlation preview", () => {
  it("previews a correlation over its own timespan, not a day", async () => {
    authorOnly();
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
    const search = (await import("@/services/search")).default;
    const spy = vi
      .spyOn(search, "search")
      .mockResolvedValue(okResponse({ hits: [], total: 0 }) as never);
    vi.mocked(streamService.schema).mockResolvedValue(
      okResponse({ schema: [{ name: "eventtype", type: "Utf8" }] }) as never,
    );
    const w = await mountDialog({
      sigmaId: "01932551-8222-400e-8529-a9e1c31d8447",
      stream: "okta_auth",
      source: "okta_system_log",
    });
    await w.find('[data-test="security-detections-new-preview-run"]').trigger("click");
    await flushPromises();
    const query = (spy.mock.calls[0][0] as any).query.query;
    expect(query.end_time - query.start_time).toBe(60 * 60_000 * 1000);
  });
});

describe("SecurityNewDetectionDialog server answers", () => {
  const withCssEscape = () => {
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
  };
  const cloudtrailSchema = () =>
    vi.mocked(streamService.schema).mockResolvedValue(
      okResponse({
        schema: Object.keys(cloudtrailEvent()).map((name) => ({ name, type: "Utf8" })),
      }) as never,
    );

  it("marks a rule that applies but cannot run on the stream yet, with the server's reason", async () => {
    authorOnly();
    withCssEscape();
    cloudtrailSchema();
    const sigma = (await import("@/services/securitySigma")).default;
    const { compileFixture, stopLoggingRule } =
      await import("@/views/Security/__fixtures__/sigmaFixtures");
    vi.spyOn(sigma, "compile").mockImplementation(async (_org, body) => {
      const res = compileFixture(body);
      if (body.rule_id || body.stream !== "ct_gap") return { data: res } as never;
      res.applicable = res.applicable.map((a) =>
        a.key === stopLoggingRule.key
          ? {
              ...a,
              runnable: false,
              reason: "Stream has no column eventsource",
              compiled: { ...a.compiled, runnable: false, where: "" },
            }
          : a,
      );
      return { data: res } as never;
    });
    const w = await mountDialog({ stream: "ct_gap", source: "aws_cloudtrail" });
    const mark = w.find(
      `[data-test="security-detections-new-not-runnable-${stopLoggingRule.key}"]`,
    );
    expect(mark.exists()).toBe(true);
    expect(mark.text()).toContain("Not runnable yet");
    expect(mark.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "Stream has no column eventsource",
    );
    expect(w.findAll('[data-test^="security-detections-new-not-runnable-"]')).toHaveLength(1);
  });

  it("saves the server-built SQL when the compile response carries it", async () => {
    authorOnly();
    withCssEscape();
    cloudtrailSchema();
    const serverSql = `SELECT "_timestamp", "host_name", "user_name" FROM "ct_server" WHERE x = 1`;
    const sigma = (await import("@/services/securitySigma")).default;
    const { compileFixture } = await import("@/views/Security/__fixtures__/sigmaFixtures");
    vi.spyOn(sigma, "compile").mockImplementation(async (_org, body) => {
      const res = compileFixture(body);
      if (body.rule_id && body.stream === "ct_server") res.sql = serverSql;
      return { data: res } as never;
    });
    vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(okResponse({}) as never);
    const w = await mountDialog({
      sigmaId: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
      stream: "ct_server",
      source: "aws_cloudtrail",
    });
    await submit(w);
    await flushPromises();
    const [, payload] = vi.mocked(alertsService.create_by_alert_id).mock.calls[0] as unknown as [
      string,
      { query_condition: { sql: string } },
    ];
    expect(payload.query_condition.sql).toBe(serverSql);
  });

  it("warns about columns not seen yet and creates them before saving", async () => {
    authorOnly();
    withCssEscape();
    cloudtrailSchema();
    const sigma = (await import("@/services/securitySigma")).default;
    const { compileFixture } = await import("@/views/Security/__fixtures__/sigmaFixtures");
    const unseen = [{ name: "eventtype", type: "Utf8" }];
    vi.spyOn(sigma, "compile").mockImplementation(async (_org, body) => {
      const res = compileFixture(body);
      if (body.rule_id && res.compiled?.runnable) res.compiled.unseenFields = unseen;
      return { data: res } as never;
    });
    const addColumns = vi.spyOn(sigma, "addColumns").mockResolvedValue({} as never);
    vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(okResponse({}) as never);
    const w = await mountDialog({
      sigmaId: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
      stream: "ct_unseen",
      source: "aws_cloudtrail",
    });
    expect(w.find('[data-test="security-detections-new-unseen-fields"]').text()).toContain(
      "eventtype",
    );
    await submit(w);
    await flushPromises();
    expect(addColumns).toHaveBeenCalledWith(expect.any(String), "ct_unseen", unseen);
    expect(alertsService.create_by_alert_id).toHaveBeenCalled();
    expect(addColumns.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(alertsService.create_by_alert_id).mock.invocationCallOrder[0],
    );
  });

  it("saves the pack's server-built SQL for a library rule when its own compile has none", async () => {
    authorOnly();
    withCssEscape();
    cloudtrailSchema();
    const serverSql = `SELECT "_timestamp", "src_endpoint_ip" FROM "ct_pack" WHERE x = 1`;
    const sigma = (await import("@/services/securitySigma")).default;
    const { compileFixture, rootRule } =
      await import("@/views/Security/__fixtures__/sigmaFixtures");
    vi.spyOn(sigma, "compile").mockImplementation(async (_org, body) => {
      const res = compileFixture(body);
      res.applicable = res.applicable.map((a) =>
        a.key === rootRule.key ? { ...a, runnable: true, sql: serverSql } : a,
      );
      return { data: res } as never;
    });
    vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(okResponse({}) as never);
    const w = await mountDialog({
      sigmaId: rootRule.key,
      stream: "ct_pack",
      source: "aws_cloudtrail",
    });
    await submit(w);
    await flushPromises();
    const [, payload] = vi.mocked(alertsService.create_by_alert_id).mock.calls[0] as unknown as [
      string,
      { query_condition: { sql: string } },
    ];
    expect(payload.query_condition.sql).toBe(serverSql);
  });

  it("shows the server's refusal, such as a duplicate name, in the dialog", async () => {
    authorOnly();
    withCssEscape();
    cloudtrailSchema();
    vi.mocked(alertsService.create_by_alert_id).mockRejectedValue({
      response: {
        status: 400,
        data: { message: "A detection named AWS_Root_Account_Activity already exists" },
      },
    });
    const w = await mountDialog({
      sigmaId: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1",
      stream: "aws_cloudtrail",
      source: "aws_cloudtrail",
    });
    await submit(w);
    await flushPromises();
    expect(w.find('[data-test="security-detections-new-save-error"]').text()).toContain(
      "A detection named AWS_Root_Account_Activity already exists",
    );
    expect(w.emitted("created")).toBeFalsy();
  });
});
