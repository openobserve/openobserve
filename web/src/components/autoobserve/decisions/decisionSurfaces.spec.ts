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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      preview: vi.fn(),
      decide: vi.fn(),
      decideBatch: vi.fn(),
      undo: vi.fn(),
      list: vi.fn(),
    },
  };
});
// The real toast store, so its de-duplication runs as it does in the app.
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

import config from "@/aws-exports";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { byTest } from "@/test/unit/helpers/draftDom";
import { queryClient } from "@/composables/query/queryClient";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions from "@/services/autoobserveDecisions";
import AlertCalibrationFindingCard from "@/components/alert_calibration/AlertCalibrationFindingCard.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import type { FindingRecord } from "@/components/alert_calibration/digests";
import type { DismissTarget } from "@/components/alert_calibration/dismissals";

const FINDING = "a".repeat(64);
const noise = {
  _timestamp: 1,
  org: "default",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  schema_version: 2,
  kind: "finding",
  rule_id: "noise",
  severity: "Medium",
  confidence: "High",
  title: "nightly-summary fires on nearly every run",
  alert_id: "a1",
  alert_name: "nightly-summary",
  finding_id: FINDING,
  scope_kind: "alert",
  scope_key: "a1",
} as unknown as FindingRecord;

const notFound = Object.assign(new Error("HTTP 404"), {
  response: { status: 404, data: { code: 404, message: "disabled" } },
});

let wrapper: VueWrapper | null = null;
let enterprise: string;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const mountWith = async (component: unknown, props: Record<string, unknown>) => {
  wrapper = mount(component as never, {
    props,
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await settle();
};

describe("decision surfaces by build and switch", () => {
  beforeEach(() => {
    enterprise = config.isEnterprise;
    queryClient.clear();
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    config.isEnterprise = enterprise;
  });

  it("enterprise_off_never_calls_the_route_and_shows_no_decision_button", async () => {
    config.isEnterprise = "false";
    await mountWith(AlertCalibrationFindingCard, { finding: noise });
    expect(byTest("alert-calibration-finding-mark-report")).toBeNull();
    wrapper?.unmount();
    await mountWith(AlertCalibrationDismissDialog, {
      open: true,
      finding: noise as unknown as DismissTarget,
    });
    expect(byTest("decision-dismiss-dialog")).toBeNull();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeTruthy();
    expect(autoobserveDecisions.list).not.toHaveBeenCalled();
    expect(autoobserveDecisions.preview).not.toHaveBeenCalled();
  });

  it("enterprise_on_with_the_switch_off_keeps_todays_card", async () => {
    config.isEnterprise = "true";
    vi.mocked(autoobserveDecisions.list).mockRejectedValue(notFound);
    await mountWith(AlertCalibrationFindingCard, { finding: noise });
    expect(autoobserveDecisions.list).toHaveBeenCalledTimes(1);
    expect(byTest("alert-calibration-finding-mark-report")).toBeNull();
    expect(byTest("alert-calibration-finding-dismiss")).toBeTruthy();
  });

  it("enterprise_on_with_the_switch_on_offers_mark_only_on_always_firing", async () => {
    config.isEnterprise = "true";
    await mountWith(AlertCalibrationFindingCard, { finding: noise });
    expect(byTest("alert-calibration-finding-mark-report")?.textContent).toContain(
      "Mark as intended report",
    );
    wrapper?.unmount();
    await mountWith(AlertCalibrationFindingCard, {
      finding: { ...noise, rule_id: "no_destination" },
    });
    expect(byTest("alert-calibration-finding-mark-report")).toBeNull();
  });
});
