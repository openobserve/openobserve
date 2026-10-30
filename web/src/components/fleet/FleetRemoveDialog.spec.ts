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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FleetRemoveDialog from "./FleetRemoveDialog.vue";
import { useRemoveRequest } from "./useCollectorActions";

const DialogStub = {
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "primaryButtonVariant"],
  emits: ["click:primary", "click:secondary", "update:open"],
  template: '<div v-if="open" data-test="dialog"><slot /></div>',
};
const ClosedCollapsible = {
  name: "OCollapsible",
  props: ["label"],
  template: "<div />",
};

function mountDialog() {
  return mount(FleetRemoveDialog, {
    global: {
      plugins: [i18n],
      stubs: { ODialog: DialogStub, OCollapsible: ClosedCollapsible, OCodeBlock: true },
    },
  });
}

const collector = (id: string, os: string | null, status = "online") => ({
  id,
  name: id,
  os,
  status: status as "online",
});

function ask(targets: ReturnType<typeof collector>[]) {
  const resolve = vi.fn();
  const online = targets.filter((c) => c.status === "online").length;
  useRemoveRequest().request.value = { targets, online, resolve };
  return resolve;
}

describe("FleetRemoveDialog", () => {
  afterEach(() => {
    useRemoveRequest().request.value = null;
  });

  it("shows the uninstall command for the collector's own platform when it is online", async () => {
    const w = mountDialog();
    ask([collector("mac-1", "macos")]);
    await w.vm.$nextTick();
    expect(w.findComponent(DialogStub).props("title")).toBe("Remove mac-1?");
    expect(w.find('[data-test="fleet-remove-dialog-message"]').text()).toContain(
      "uninstall it on its host first",
    );
    const cmd = w.findComponent({ name: "FleetUninstallCommand" });
    expect(cmd.props("platform")).toBe("macos");
    expect(cmd.props("showPlatforms")).toBe(true);
    expect(w.find('[data-test="fleet-remove-dialog-uninstall"]').exists()).toBe(false);
  });

  it("folds the command away when every collector is offline", async () => {
    const w = mountDialog();
    ask([collector("a", "linux", "offline"), collector("b", "linux", "offline")]);
    await w.vm.$nextTick();
    expect(w.findComponent(DialogStub).props("title")).toBe("Remove 2 collectors?");
    expect(w.find('[data-test="fleet-remove-dialog-uninstall"]').exists()).toBe(true);
  });

  it("resolves the request with the answer and closes", async () => {
    const w = mountDialog();
    const resolve = ask([collector("a", "linux")]);
    await w.vm.$nextTick();
    w.findComponent(DialogStub).vm.$emit("click:primary");
    await w.vm.$nextTick();
    expect(resolve).toHaveBeenCalledWith(true);
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it("treats closing the dialog as a cancel", async () => {
    const w = mountDialog();
    const resolve = ask([collector("a", "linux")]);
    await w.vm.$nextTick();
    w.findComponent(DialogStub).vm.$emit("update:open", false);
    expect(resolve).toHaveBeenCalledWith(false);
  });
});
