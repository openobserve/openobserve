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
import { flushPromises, mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import type { InsightCta } from "./insightCopy";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const org = vi.hoisted(() => ({ value: "org-a" }));
vi.mock("@/composables/query", () => ({ useOrgId: () => org }));
vi.mock("@/stores", () => ({
  default: {
    state: {
      get selectedOrganization() {
        return { identifier: org.value };
      },
    },
  },
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/http", () => ({ default: () => ({ get }) }));
vi.mock("@/composables/alerts/useAlertCreation", () => ({ requestAlertCreation: vi.fn() }));
vi.mock("./bulk/useBulkReview", () => ({
  openBulkReview: vi.fn(),
  loadReviewContext: vi.fn(),
  readStreamFields: vi.fn(),
}));
vi.mock("@/components/alert_calibration/reviewAlert", () => ({ openAlertReview: vi.fn() }));

const { useInsightActions } = await import("./useInsightActions");
const { queryClient } = await import("@/composables/query/queryClient");
const { ALERT_PREFILL_KEY } = await import("@/utils/alerts/alertPrefillStorage");

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

const choose: InsightCta = {
  key: "who",
  action: "chooseWhoGetsNotified",
  label: raw("Choose who gets notified"),
  note: null,
  target: { type: "destinations", alertId: "a1", alertName: "probe", destinations: ["hook"] },
};

beforeEach(() => {
  org.value = "org-a";
  push.mockReset();
  get.mockReset();
  queryClient.clear();
  sessionStorage.clear();
});

describe("useInsightActions: a destinations handoff from an earlier org (F11)", () => {
  it("leaves the newer org's stored handoff alone and opens nothing", async () => {
    let answer!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const done = run(choose);
    await flushPromises();
    org.value = "org-b";
    const newer = JSON.stringify({ version: 1, source: "calibration", target: { alertId: "b1" } });
    sessionStorage.setItem(ALERT_PREFILL_KEY, newer);
    answer({ data: { list: [{ alert_id: "a1", name: "probe", folder_id: "ops" }] } });
    await done;
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBe(newer);
    expect(push).not.toHaveBeenCalled();
  });

  it("still writes the handoff and opens the editor when the org stayed", async () => {
    get.mockResolvedValueOnce({
      data: { list: [{ alert_id: "a1", name: "probe", folder_id: "ops" }] },
    });
    await run(choose);
    expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY) ?? "null")).toMatchObject({
      target: { alertId: "a1" },
      focus: "destinations",
    });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
