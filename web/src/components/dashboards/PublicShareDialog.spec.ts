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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/public_dashboards_admin", () => ({
  default: { get: vi.fn(), publish: vi.fn(), revoke: vi.fn() },
}));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn(), showPositiveNotification: vi.fn() }),
}));

import adminService from "@/services/public_dashboards_admin";
import PublicShareDialog from "@/components/dashboards/PublicShareDialog.vue";

// Stub ODialog so the test can trigger its primary/secondary actions and its
// @show; render the body slot so the form/selector mount.
const ODialogStub = {
  name: "ODialog",
  template:
    '<div><button class="dlg-primary" @click="$emit(\'click:primary\')" /><button class="dlg-secondary" @click="$emit(\'click:secondary\')" /><slot /></div>',
  props: [
    "open",
    "size",
    "title",
    "secondaryButtonLabel",
    "secondaryButtonVariant",
    "primaryButtonLabel",
    "primaryButtonLoading",
    "primaryButtonDisabled",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "show"],
  mounted() {
    this.$emit("show");
  },
};

// Stub the variable selector to emit the author's live selection on mount.
const VVSStub = {
  name: "VariablesValueSelector",
  template: "<div />",
  props: ["variablesConfig", "selectedTimeDate", "initialVariableValues", "showDynamicFilters"],
  emits: ["variablesData"],
  mounted() {
    this.$emit("variablesData", { values: [{ name: "env", value: "prod" }] });
  },
};

const build = () =>
  mount(PublicShareDialog, {
    props: {
      modelValue: true,
      dashboardId: "dash-1",
      variablesConfig: { list: [{ name: "env" }] },
      timeObj: { start_time: new Date(0), end_time: new Date(1000) },
      currentValues: { values: [{ name: "env", value: "prod" }] },
    },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: { ODialog: ODialogStub, VariablesValueSelector: VVSStub },
    },
  });

describe("PublicShareDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the publish payload from the form + live variable selection", async () => {
    (adminService.get as any).mockRejectedValue({ response: { status: 404 } });
    (adminService.publish as any).mockResolvedValue({ data: { slug: "xyz" } });
    const w = build();
    await flushPromises();

    await w.find(".dlg-primary").trigger("click");
    await flushPromises();

    expect(adminService.publish).toHaveBeenCalledTimes(1);
    const [, dashId, payload] = (adminService.publish as any).mock.calls[0];
    expect(dashId).toBe("dash-1");
    expect(payload.visibility).toBe("public");
    expect(payload.time_range.allowed_presets_secs).toEqual([3600, 86400]);
    expect(payload.time_range.default_range_secs).toBe(3600);
    expect(payload.rebuild_secs).toBe(60);
    // Frozen from the selector's emitted current selection.
    expect(payload.frozen_variables).toEqual({ env: "prod" });
  });

  it("opens in published mode when a share already exists", async () => {
    (adminService.get as any).mockResolvedValue({ data: { slug: "existing" } });
    const w = build();
    await flushPromises();
    expect(
      w.find('[data-test="dashboards-public-share-dialog-copy-btn"]').exists(),
    ).toBe(true);
    expect(adminService.publish).not.toHaveBeenCalled();
  });

  it("revokes via the secondary action in published mode", async () => {
    (adminService.get as any).mockResolvedValue({ data: { slug: "existing" } });
    (adminService.revoke as any).mockResolvedValue({ data: { deleted: true } });
    const w = build();
    await flushPromises();
    await w.find(".dlg-secondary").trigger("click");
    await flushPromises();
    expect(adminService.revoke).toHaveBeenCalledWith(expect.any(String), "dash-1");
  });
});
