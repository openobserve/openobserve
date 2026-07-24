// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckHttpConfig from "./CheckHttpConfig.vue";
import { mockProtocolCheckHttp, mockHttpConfig } from "@/test/unit/mockData/synthetics";
import type { ProtocolCheck } from "@/types/synthetics";

// ── Stubs ──────────────────────────────────────────────────────────────────────

const OInputStub = {
  inheritAttrs: false,
  props: ["modelValue", "type", "label", "placeholder", "required", "rows"],
  emits: ["update:modelValue"],
  template: `
    <input
      v-if="type !== 'textarea'"
      :value="modelValue"
      :type="type || 'text'"
      :placeholder="placeholder"
      :required="required"
      :data-test="$attrs['data-test']"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <textarea
      v-else
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :required="required"
      :data-test="$attrs['data-test']"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
};

const OSelectStub = {
  inheritAttrs: false,
  props: ["modelValue", "options", "label"],
  emits: ["update:modelValue"],
  template: `
    <select
      :value="modelValue"
      :data-test="$attrs['data-test']"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option
        v-for="opt in options"
        :key="String(opt.value)"
        :value="String(opt.value)"
      >{{ opt.label }}</option>
    </select>
  `,
};

const OSwitchStub = {
  inheritAttrs: false,
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: `
    <input
      type="checkbox"
      :checked="modelValue"
      :data-test="$attrs['data-test']"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
  `,
};

const OButtonStub = {
  inheritAttrs: false,
  props: ["variant", "size", "ariaLabel"],
  emits: ["click"],
  template: `
    <button
      :data-test="$attrs['data-test']"
      :aria-label="ariaLabel"
      @click="$emit('click')"
    >
      <slot name="icon-left" />
      <slot />
    </button>
  `,
};

const OIconStub = {
  props: ["name", "size"],
  template: "<i />",
};

const STUBS = {
  OInput: OInputStub,
  OSelect: OSelectStub,
  OSwitch: OSwitchStub,
  OButton: OButtonStub,
  OIcon: OIconStub,
};

describe("CheckHttpConfig", () => {
  let wrapper: VueWrapper;

  function mountHttp(props: Record<string, unknown> = {}) {
    return mount(CheckHttpConfig, {
      props: { check: mockProtocolCheckHttp, ...props },
      global: { stubs: STUBS },
    });
  }

  beforeEach(() => {
    wrapper = mountHttp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Initial render ────────────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render method select with GET value", () => {
      const methodSelect = wrapper.find('[data-test="synthetics-check-http-method-select"]');
      expect(methodSelect.exists()).toBe(true);
      expect((methodSelect.element as HTMLSelectElement).value).toBe("GET");
    });

    it("should render timeout input with correct value", () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-http-timeout-input"]');
      expect(timeoutInput.exists()).toBe(true);
      expect((timeoutInput.element as HTMLInputElement).value).toBe("30000");
    });

    it("should render follow redirects switch as checked", () => {
      const followSwitch = wrapper.find(
        '[data-test="synthetics-check-http-follow-redirects-switch"]',
      );
      expect(followSwitch.exists()).toBe(true);
      expect((followSwitch.element as HTMLInputElement).checked).toBe(true);
    });

    it("should render the expected number of header rows", () => {
      // mockHttpConfig has 1 header
      const headerName0 = wrapper.find('[data-test="synthetics-check-http-header-name-0"]');
      const headerValue0 = wrapper.find('[data-test="synthetics-check-http-header-value-0"]');
      const headerName1 = wrapper.find('[data-test="synthetics-check-http-header-name-1"]');
      expect(headerName0.exists()).toBe(true);
      expect(headerValue0.exists()).toBe(true);
      expect(headerName1.exists()).toBe(false);
    });

    it("should render header name input with correct value", () => {
      const headerName = wrapper.find('[data-test="synthetics-check-http-header-name-0"]');
      expect((headerName.element as HTMLInputElement).value).toBe("Authorization");
    });

    it("should render header value input with correct value", () => {
      const headerValue = wrapper.find('[data-test="synthetics-check-http-header-value-0"]');
      expect((headerValue.element as HTMLInputElement).value).toBe("Bearer ****");
    });

    it("should NOT render body textarea when method is GET", () => {
      const bodyTextarea = wrapper.find('[data-test="synthetics-check-http-body-textarea"]');
      expect(bodyTextarea.exists()).toBe(false);
    });

    it("should render the expected number of assertion rows", () => {
      // mockHttpConfig has 2 assertions
      const assertion0 = wrapper.find('[data-test="synthetics-check-http-assertion-field-0"]');
      const assertion1 = wrapper.find('[data-test="synthetics-check-http-assertion-field-1"]');
      const assertion2 = wrapper.find('[data-test="synthetics-check-http-assertion-field-2"]');
      expect(assertion0.exists()).toBe(true);
      expect(assertion1.exists()).toBe(true);
      expect(assertion2.exists()).toBe(false);
    });
  });

  // ── Method change ─────────────────────────────────────────────────────────────

  describe("method change", () => {
    it("should emit update:check with new method when method select changes", async () => {
      const methodSelect = wrapper.find('[data-test="synthetics-check-http-method-select"]');
      await methodSelect.setValue("POST");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.method).toBe("POST");
    });

    it("should render body textarea when method is POST", async () => {
      const postCheck: ProtocolCheck = {
        ...mockProtocolCheckHttp,
        http: { ...mockHttpConfig, method: "POST", body: '{"key":"value"}' },
      };
      await wrapper.setProps({ check: postCheck });

      const bodyTextarea = wrapper.find('[data-test="synthetics-check-http-body-textarea"]');
      expect(bodyTextarea.exists()).toBe(true);
      expect((bodyTextarea.element as HTMLTextAreaElement).value).toBe('{"key":"value"}');
    });

    it("should hide body textarea when method is HEAD", async () => {
      const headCheck: ProtocolCheck = {
        ...mockProtocolCheckHttp,
        http: { ...mockHttpConfig, method: "HEAD" },
      };
      await wrapper.setProps({ check: headCheck });

      const bodyTextarea = wrapper.find('[data-test="synthetics-check-http-body-textarea"]');
      expect(bodyTextarea.exists()).toBe(false);
    });
  });

  // ── Timeout change ────────────────────────────────────────────────────────────

  describe("timeout change", () => {
    it("should emit update:check with new timeout_ms when timeout input changes", async () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-http-timeout-input"]');
      await timeoutInput.setValue("10000");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.timeout_ms).toBe(10000);
    });
  });

  // ── Follow redirects toggle ───────────────────────────────────────────────────

  describe("follow redirects toggle", () => {
    it("should emit update:check with toggled follow_redirects when switch is toggled", async () => {
      const followSwitch = wrapper.find(
        '[data-test="synthetics-check-http-follow-redirects-switch"]',
      );
      await followSwitch.setValue(false);
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.follow_redirects).toBe(false);
    });
  });

  // ── Headers CRUD ──────────────────────────────────────────────────────────────

  describe("headers CRUD", () => {
    it("should add a new empty header row when add header button is clicked", async () => {
      // Initially 1 header (index 0 exists, index 1 does not)
      expect(wrapper.find('[data-test="synthetics-check-http-header-name-1"]').exists()).toBe(
        false,
      );

      const addBtn = wrapper.find('[data-test="synthetics-check-http-add-header-btn"]');
      await addBtn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.headers).toHaveLength(2);
      expect(lastEmit.http!.headers[1]).toEqual({ name: "", value: "" });
    });

    it("should update header name and emit update:check when header name input changes", async () => {
      const headerName = wrapper.find('[data-test="synthetics-check-http-header-name-0"]');
      await headerName.setValue("X-Custom-Header");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.headers[0].name).toBe("X-Custom-Header");
      // value unchanged
      expect(lastEmit.http!.headers[0].value).toBe("Bearer ****");
    });

    it("should update header value and emit update:check when header value input changes", async () => {
      const headerValue = wrapper.find('[data-test="synthetics-check-http-header-value-0"]');
      await headerValue.setValue("Token xyz");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.headers[0].value).toBe("Token xyz");
      // name unchanged
      expect(lastEmit.http!.headers[0].name).toBe("Authorization");
    });

    it("should remove a header when remove button is clicked", async () => {
      // Feed two headers via setProps so there is something to remove
      const checkWithTwoHeaders: ProtocolCheck = {
        ...mockProtocolCheckHttp,
        http: {
          ...mockHttpConfig,
          headers: [
            { name: "Auth", value: "token" },
            { name: "X-ID", value: "123" },
          ],
        },
      };
      await wrapper.setProps({ check: checkWithTwoHeaders });

      const removeBtn = wrapper.find('[data-test="synthetics-check-http-header-remove-0"]');
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.headers).toHaveLength(1);
      expect(lastEmit.http!.headers[0]).toEqual({ name: "X-ID", value: "123" });
    });
  });

  // ── Assertions CRUD ───────────────────────────────────────────────────────────

  describe("assertions CRUD", () => {
    it("should add a new default assertion when add assertion button is clicked", async () => {
      // Initially 2 assertions (index 0,1 exist; index 2 does not)
      expect(wrapper.find('[data-test="synthetics-check-http-assertion-field-2"]').exists()).toBe(
        false,
      );

      const addBtn = wrapper.find('[data-test="synthetics-check-http-add-assertion-btn"]');
      await addBtn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.assertions).toHaveLength(3);
      expect(lastEmit.http!.assertions[2]).toEqual({
        field: "status_code",
        operator: "eq",
        value: "",
      });
    });

    it("should update assertion field and emit update:check when field select changes", async () => {
      const fieldSelect = wrapper.find('[data-test="synthetics-check-http-assertion-field-0"]');
      await fieldSelect.setValue("body");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.assertions[0].field).toBe("body");
    });

    it("should update assertion operator and emit update:check when operator select changes", async () => {
      const operatorSelect = wrapper.find(
        '[data-test="synthetics-check-http-assertion-operator-0"]',
      );
      await operatorSelect.setValue("contains");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.assertions[0].operator).toBe("contains");
    });

    it("should update assertion value and emit update:check when value input changes", async () => {
      const valueInput = wrapper.find('[data-test="synthetics-check-http-assertion-value-0"]');
      await valueInput.setValue("201");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.assertions[0].value).toBe("201");
    });

    it("should remove an assertion when remove button is clicked", async () => {
      const removeBtn = wrapper.find('[data-test="synthetics-check-http-assertion-remove-0"]');
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.assertions).toHaveLength(1);
    });
  });

  // ── Body textarea change ──────────────────────────────────────────────────────

  describe("body textarea change", () => {
    it("should emit update:check with new body when textarea changes", async () => {
      const postCheck: ProtocolCheck = {
        ...mockProtocolCheckHttp,
        http: { ...mockHttpConfig, method: "POST", body: "" },
      };
      await wrapper.setProps({ check: postCheck });

      const bodyTextarea = wrapper.find('[data-test="synthetics-check-http-body-textarea"]');
      expect(bodyTextarea.exists()).toBe(true);
      await bodyTextarea.setValue('{"status":"ok"}');
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      // find the latest emit that includes a body change (could be multiple from setProps)
      const lastEmit = emitted![emitted!.length - 1][0] as ProtocolCheck;
      expect(lastEmit.http!.body).toBe('{"status":"ok"}');
    });
  });
});
