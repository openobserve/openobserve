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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import CustomConfirmDialog from "./CustomConfirmDialog.vue";

// ---------------------------------------------------------------------------
// ODialog stub
// Stubs the dialog so tests are deterministic — no Portal/Reka teleport — and
// so we can assert on props forwarded by CustomConfirmDialog and synthesise the
// click:primary / click:secondary events the component listens to.
// ---------------------------------------------------------------------------

const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: "md" },
    title: { type: String, default: "" },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    primaryButtonLabel: { type: String, default: "" },
    secondaryButtonLabel: { type: String, default: "" },
  },
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-persistent="String(persistent)"
      :data-show-close="String(showClose)"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot />
      <button data-test="o-dialog-stub-primary" @click="$emit('click:primary')">
        {{ primaryButtonLabel }}
      </button>
      <button data-test="o-dialog-stub-secondary" @click="$emit('click:secondary')">
        {{ secondaryButtonLabel }}
      </button>
    </div>
  `,
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildWrapper(
  props: Record<string, any> = {},
  storeInstance?: any,
): VueWrapper<any> {
  const vuexStore =
    storeInstance ??
    createStore({ state: { theme: "light" } });

  return mount(CustomConfirmDialog, {
    props: {
      modelValue: true,
      ...props,
    },
    global: {
      plugins: [vuexStore],
      stubs: { ODialog: ODialogStub },
    },
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("CustomConfirmDialog", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  // ── Renders with minimum props ────────────────────────────────────────────

  describe("renders with minimum props", () => {
    it("mounts without error", () => {
      wrapper = buildWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("has the component name 'CustomConfirmDialog'", () => {
      wrapper = buildWrapper();

      expect(wrapper.vm.$options.name).toBe("CustomConfirmDialog");
    });

    it("renders the ODialog stub", () => {
      wrapper = buildWrapper({ modelValue: true });

      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("renders the confirm-card container", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="custom-confirm-card"]').exists()).toBe(true);
    });
  });

  // ── Edge cases — empty / null / undefined props ───────────────────────────

  describe("edge cases", () => {
    it("defaults modelValue to false when not provided", () => {
      wrapper = mount(CustomConfirmDialog, {
        global: {
          plugins: [createStore({ state: { theme: "light" } })],
          stubs: { ODialog: ODialogStub },
        },
      });

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("renders an empty message paragraph when message prop is not provided", () => {
      wrapper = buildWrapper();

      const msg = wrapper.find('[data-test="dialog-message"]');
      expect(msg.exists()).toBe(true);
      expect(msg.text()).toBe("");
    });

    it("uses default title 'Confirm Action' when title prop is omitted", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("title")).toBe("Confirm Action");
    });
  });

  // ── Props forwarded to ODialog ────────────────────────────────────────────

  describe("props forwarded to ODialog", () => {
    it("forwards open=true when modelValue=true", () => {
      wrapper = buildWrapper({ modelValue: true });

      expect(wrapper.findComponent(ODialogStub).props("open")).toBe(true);
    });

    it("forwards open=false when modelValue=false", () => {
      wrapper = buildWrapper({ modelValue: false });

      expect(wrapper.findComponent(ODialogStub).props("open")).toBe(false);
    });

    it("forwards a custom title", () => {
      wrapper = buildWrapper({ title: "Delete Item?" });

      expect(wrapper.findComponent(ODialogStub).props("title")).toBe("Delete Item?");
    });

    it("forwards the message to the dialog body paragraph", () => {
      wrapper = buildWrapper({ message: "Are you sure?" });

      expect(wrapper.find('[data-test="dialog-message"]').text()).toBe("Are you sure?");
    });

    it("forwards persistent=true", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("persistent")).toBe(true);
    });

    it("forwards showClose=false", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("showClose")).toBe(false);
    });

    it("forwards size='sm'", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("size")).toBe("sm");
    });

    it("forwards secondaryButtonLabel='Cancel'", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("forwards primaryButtonLabel='Clear & Continue'", () => {
      wrapper = buildWrapper();

      expect(wrapper.findComponent(ODialogStub).props("primaryButtonLabel")).toBe("Clear & Continue");
    });
  });

  // ── Interactive elements fire right events ────────────────────────────────

  describe("interactive elements", () => {
    it("emits 'cancel' when ODialog emits click:secondary", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");

      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("emits 'confirm' when ODialog emits click:primary", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");

      expect(wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("does NOT emit 'confirm' when secondary is clicked", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");

      expect(wrapper.emitted("confirm")).toBeFalsy();
    });

    it("does NOT emit 'cancel' when primary is clicked", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");

      expect(wrapper.emitted("cancel")).toBeFalsy();
    });
  });

  // ── update:modelValue emissions ───────────────────────────────────────────

  describe("update:modelValue emissions", () => {
    it("emits update:modelValue=false after cancel is triggered", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");
      await nextTick();

      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("emits update:modelValue=false after confirm is triggered", async () => {
      wrapper = buildWrapper();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");
      await nextTick();

      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });
  });

  // ── v-if / conditional branches ───────────────────────────────────────────

  describe("internal state — isVisible", () => {
    it("isVisible is initialised to modelValue", () => {
      wrapper = buildWrapper({ modelValue: true });

      expect((wrapper.vm as any).isVisible).toBe(true);
    });

    it("isVisible updates when modelValue prop changes to true", async () => {
      wrapper = buildWrapper({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect((wrapper.vm as any).isVisible).toBe(true);
    });

    it("isVisible updates when modelValue prop changes to false", async () => {
      wrapper = buildWrapper({ modelValue: true });

      await wrapper.setProps({ modelValue: false });
      await nextTick();

      expect((wrapper.vm as any).isVisible).toBe(false);
    });

    it("propagates prop change to ODialog open prop", async () => {
      wrapper = buildWrapper({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.findComponent(ODialogStub).props("open")).toBe(true);
    });

    it("sets isVisible to false after onCancel is called", () => {
      wrapper = buildWrapper({ modelValue: true });

      (wrapper.vm as any).onCancel();

      expect((wrapper.vm as any).isVisible).toBe(false);
    });

    it("sets isVisible to false after onConfirm is called", () => {
      wrapper = buildWrapper({ modelValue: true });

      (wrapper.vm as any).onConfirm();

      expect((wrapper.vm as any).isVisible).toBe(false);
    });
  });

  // ── Async paths ───────────────────────────────────────────────────────────

  describe("async reactivity paths", () => {
    it("ODialog open prop reflects true after modelValue changes from false to true", async () => {
      wrapper = buildWrapper({ modelValue: false });

      let dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });
  });

  // ── Exposed methods ───────────────────────────────────────────────────────

  describe("exposed methods", () => {
    it("exposes onCancel as a function", () => {
      wrapper = buildWrapper();

      expect(typeof (wrapper.vm as any).onCancel).toBe("function");
    });

    it("exposes onConfirm as a function", () => {
      wrapper = buildWrapper();

      expect(typeof (wrapper.vm as any).onConfirm).toBe("function");
    });

    it("onConfirm invocation emits 'confirm'", () => {
      wrapper = buildWrapper();

      (wrapper.vm as any).onConfirm();

      expect(wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("onCancel invocation emits 'cancel'", () => {
      wrapper = buildWrapper();

      (wrapper.vm as any).onCancel();

      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });
  });
});
