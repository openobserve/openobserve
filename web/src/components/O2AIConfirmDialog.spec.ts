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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import O2AIConfirmDialog from "./O2AIConfirmDialog.vue";

describe("O2AIConfirmDialog delete confirmations", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  const mountDialog = (tool: string, args?: Record<string, unknown>) => {
    wrapper = mount(O2AIConfirmDialog, {
      props: { visible: true, confirmation: { tool, args } },
    });
    return wrapper;
  };
  const name = () => wrapper.find('[data-test="o2-ai-confirm-dialog-name"]');
  const title = () => wrapper.find(".confirmation-title");

  it("names the entity in bold and turns the confirm button destructive", () => {
    mountDialog("DeleteAlert", { name: "cpu-high", alert_id: "a1b2c3" });

    expect(name().text()).toBe("cpu-high");
    expect(name().classes()).toContain("font-semibold");
    expect(title().text()).toBe("Are you sure you want to delete the cpu-high alert?");
    const confirm = wrapper.find('[data-test="o2-ai-confirm-dialog-confirm"]');
    expect(confirm.attributes("data-o2-variant")).toBe("destructive");
    expect(confirm.text()).toBe("Yes");
  });

  it("prefers a *_name argument over a raw id", () => {
    mountDialog("DeleteStream", { stream_name: "app_logs", id: "42" });
    expect(name().text()).toBe("app_logs");
  });

  it("falls back to the id only when the tool carries no name", () => {
    mountDialog("DeleteDashboard", { dashboard_id: "7Xyz" });
    expect(name().text()).toBe("7Xyz");
    expect(title().text()).toBe("Are you sure you want to delete the 7Xyz dashboard?");
  });

  it("asks about the entity without a name when there is nothing to name it by", () => {
    mountDialog("DeleteReport", {});
    expect(name().exists()).toBe(false);
    expect(title().text()).toBe("Are you sure you want to delete this report?");
    expect(
      wrapper.find('[data-test="o2-ai-confirm-dialog-confirm"]').attributes("data-o2-variant"),
    ).toBe("destructive");
  });

  it("emits confirm from the destructive button", async () => {
    mountDialog("DeleteAlert", { name: "cpu-high" });
    await wrapper.find('[data-test="o2-ai-confirm-dialog-confirm"]').trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("keeps the regular confirm button for non-delete tools", () => {
    mountDialog("CreateAlert", { name: "cpu-high" });
    expect(wrapper.find('[data-test="o2-ai-confirm-dialog-confirm"]').exists()).toBe(false);
    expect(name().exists()).toBe(false);
  });
});
