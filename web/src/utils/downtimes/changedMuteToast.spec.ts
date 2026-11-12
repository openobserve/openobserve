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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import alerts from "@/services/alerts";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import { useAlertActions } from "@/composables/alerts/useAlertActions";
import { useDowntimeRowActions } from "@/composables/downtimes/useDowntimeRowActions";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/downtimes", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "acme" },
    userInfo: { email: "me@acme.io" },
    timezone: "UTC",
  },
});

const owner = <T>(use: () => T): T => {
  let api: T | undefined;
  mount(
    defineComponent({
      setup() {
        api = use();
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store, i18n] } },
  );
  return api!;
};

const row = (id: string) => ({ id, name: id, ends_at: 1, version: 3, folder_id: "ops" });
const httpError = (status: number, data: unknown = {}) => ({ response: { status, data } });
const changedToasts = () =>
  toastRecords.filter((r) => r.open && r.message === "This mute changed. Open the downtime.");

describe("changed-mute toast across screens", () => {
  beforeEach(() => {
    dismissAll();
    queryClient.clear();
    push.mockReset();
    for (const fn of [...Object.values(alerts), ...Object.values(downtimes)])
      if (vi.isMockFunction(fn)) fn.mockReset();
  });

  it("keeps one toast, linked to the latest mute, whichever screen refused", async () => {
    const anomalies = owner(useDowntimeRowActions);
    const synthetics = owner(useDowntimeRowActions);
    const alertList = owner(useAlertActions);
    vi.mocked(downtimes.cancel).mockRejectedValue(httpError(409));
    await anomalies.end(row("d1"));
    await synthetics.end(row("d2"));
    expect(changedToasts()).toHaveLength(1);
    changedToasts()[0].action?.handler();
    expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ params: { id: "d2" } }));

    vi.mocked(alerts.cancelAlertMute).mockRejectedValue(
      httpError(409, { code: "version_changed", version: 5, ends_at: 9 }),
    );
    await alertList.endMute({ alertId: "a1", name: "cpu", folderId: "ops" }, row("d3"));
    expect(changedToasts()).toHaveLength(1);
    changedToasts()[0].action?.handler();
    expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ params: { id: "d3" } }));
    dismissAll();
  });
});
