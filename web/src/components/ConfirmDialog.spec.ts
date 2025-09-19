// Copyright 2023 OpenObserve Inc.
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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import i18n from "@/locales";
import { Dialog } from "quasar";

installQuasar({
  plugins: [Dialog],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("ConfirmDialog", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(ConfirmDialog, {
      attachTo: "#app",
      shallow: false,
      props: {
        title: "Dialog Title",
        message: "Dialog Message",
        confirmDelete: true,
        modelValue: true,
      },
      global: {
        plugins: [i18n],
        stubs: {
          'q-dialog': {
            template: '<div class="q-dialog"><slot /></div>'
          },
          'q-card': {
            template: '<div class="q-card"><slot /></div>'
          },
          'q-card-section': {
            template: '<div class="q-card-section"><slot /></div>'
          },
          'q-card-actions': {
            template: '<div class="q-card-actions"><slot /></div>'
          },
          'q-btn': {
            template: '<button @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']"><slot /></button>'
          }
        }
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Clear any pending timers to prevent unhandled errors
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("should mount ConfirmDialog component", async () => {
    const documentWrapper = new DOMWrapper(document.body);
    const dialog = documentWrapper.find(".q-dialog");
    expect(dialog.exists()).toBeTruthy();
  });

  it("should display title and message", () => {
    expect(wrapper.text()).toContain("Dialog Title");
    expect(wrapper.text()).toContain("Dialog Message");
  });

  it("should emit update:ok when confirm button is clicked", async () => {
    const confirmButton = wrapper.find('[data-test="confirm-button"]');
    expect(confirmButton.exists()).toBe(true);
    await confirmButton.trigger("click");
    expect(wrapper.emitted("update:ok")).toBeTruthy();
    expect(wrapper.emitted("update:ok").length).toBeGreaterThan(0);
  });

  it("should emit update:cancel when cancel button is clicked", async () => {
    const cancelButton = wrapper.find('[data-test="cancel-button"]');
    expect(cancelButton.exists()).toBe(true);
    await cancelButton.trigger("click");
    expect(wrapper.emitted("update:cancel")).toBeTruthy();
    expect(wrapper.emitted("update:cancel").length).toBeGreaterThan(0);
  });

  it("should expose onCancel and onConfirm functions", () => {
    expect(typeof wrapper.vm.onCancel).toBe("function");
    expect(typeof wrapper.vm.onConfirm).toBe("function");
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("ConfirmDialog");
  });

  it("should call onCancel method", () => {
    const onCancelSpy = vi.spyOn(wrapper.vm, 'onCancel');
    wrapper.vm.onCancel();
    expect(onCancelSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:cancel")).toBeTruthy();
  });

  it("should call onConfirm method", () => {
    const onConfirmSpy = vi.spyOn(wrapper.vm, 'onConfirm');
    wrapper.vm.onConfirm();
    expect(onConfirmSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:ok")).toBeTruthy();
  });
});
