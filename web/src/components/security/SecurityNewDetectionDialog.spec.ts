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

describe("SecurityNewDetectionDialog history preview", () => {
  it("runs the draft on the server over the chosen range and says exactly what was evaluated", async () => {
    authorOnly();
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
    const sigma = (await import("@/services/securitySigma")).default as any;
    const { previewFixture } = await import("@/views/Security/__fixtures__/sigmaFixtures");
    // No sample rows: jsdom cannot unmount the results table when the range changes.
    sigma.previewDetection.mockResolvedValue({ data: previewFixture({ sample: [] }) });
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
    expect(sigma.previewDetection).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        rule_id: "01932551-8222-400e-8529-a9e1c31d8447",
        stream: "okta_auth",
        range_minutes: 1440,
        period: 60,
        frequency: 15,
      }),
    );
    const summary = w.find('[data-test="security-detections-new-preview-summary"]').text();
    expect(summary).toContain("1 firing between");
    expect(summary).toContain("93 windows of 60 min, starting every 15 min");
    expect(w.find('[data-test="security-detections-new-preview-windows"]').exists()).toBe(true);

    await w.find('[data-test="security-detections-new-preview-range-10080"]').trigger("click");
    await flushPromises();
    // A different range is a different preview, so the day's answer is no longer shown.
    expect(w.find('[data-test="security-detections-new-preview-windows"]').exists()).toBe(false);
    await w.find('[data-test="security-detections-new-preview-run"]').trigger("click");
    await flushPromises();
    expect(sigma.previewDetection).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ range_minutes: 10080 }),
    );
  });
});

describe("SecurityNewDetectionDialog edit in place", () => {
  it("opens on the stored rule and saves through the server, keeping the name", async () => {
    authorOnly();
    const { sigmaCatalogFixture } = await import("@/views/Security/__fixtures__/sigmaFixtures");
    const rule = sigmaCatalogFixture.rules.find((r) => !r.correlation)!;
    const sigma = (await import("@/services/securitySigma")).default as any;
    vi.mocked(streamService.schema).mockResolvedValue(
      okResponse({
        schema: Object.keys(cloudtrailEvent()).map((name) => ({ name, type: "Utf8" })),
      }) as never,
    );
    const router = await makeSecurityRouter("/security/detections");
    wrapper = mount(SecurityNewDetectionDialog, {
      props: {
        open: true,
        orgId: "default",
        existingNames: ["Root_Login__aws_cloudtrail"],
        edit: {
          alertId: "a1",
          name: "Root_Login__aws_cloudtrail",
          yaml: rule.yaml,
          stream: "aws_cloudtrail",
          sourceType: "aws_cloudtrail",
          period: 30,
          frequency: 10,
          silence: 5,
          destinations: [],
        },
      },
      global: { provide: { store }, plugins: [store, router], stubs: { CodeQueryEditor: true } },
    });
    await flushPromises();
    const w = wrapper;
    expect(w.find('[data-test="security-detections-new-mode"]').exists()).toBe(false);
    expect(w.find('[data-test="security-detections-new-backfill"]').exists()).toBe(false);
    const period = w.find('[data-test="security-detections-new-period"] input');
    expect((period.element as HTMLInputElement).value).toBe("30");
    // Its own name is not "taken" by itself.
    expect(w.find('[data-test="security-detections-new-name-taken"]').exists()).toBe(false);

    // A saved detection previews with its own exceptions, so the server needs its id.
    const { previewFixture } = await import("@/views/Security/__fixtures__/sigmaFixtures");
    sigma.previewDetection.mockResolvedValue({ data: previewFixture({ sample: [] }) });
    const css = globalThis.CSS;
    Object.assign(globalThis, { CSS: { escape: (v: string) => v } });
    onTestFinished(() => {
      Object.assign(globalThis, { CSS: css });
    });
    await w.find('[data-test="security-detections-new-preview-run"]').trigger("click");
    await flushPromises();
    expect(sigma.previewDetection).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ alert_id: "a1", stream: "aws_cloudtrail" }),
    );

    await w.find("form").trigger("submit");
    await vi.waitFor(() => expect(sigma.updateDetection).toHaveBeenCalled());
    await flushPromises();
    expect(sigma.updateDetection).toHaveBeenCalledWith("default", "a1", {
      rule_yaml: rule.yaml,
      stream: "aws_cloudtrail",
      source_type: "aws_cloudtrail",
      period: 30,
      frequency: 10,
      silence: 5,
      destinations: [],
    });
    expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    expect(w.emitted("updated")).toBeTruthy();
  });
});
