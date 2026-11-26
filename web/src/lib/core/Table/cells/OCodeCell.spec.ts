// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OCodeCell from "./OCodeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

const valueSpan = (wrapper: ReturnType<typeof mount>) => wrapper.find("span.font-mono");

describe("OCodeCell", () => {
  it("shows the full value on hover only when it is cut, with no always-on title", () => {
    const wrapper = mount(OCodeCell, { props: { value: "trace-0123456789" } });

    expect(valueSpan(wrapper).attributes("title")).toBeUndefined();
    const tip = wrapper.findComponent(OTooltip);
    expect(tip.props("overflowOnly")).toBe(true);
    expect(tip.props("content")).toBeUndefined();
  });

  it("shows the given text on hover in place of the value", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "abc", tooltip: raw("Full value: abc-def") },
    });

    expect(wrapper.findComponent(OTooltip).props("content")).toBe("Full value: abc-def");
  });

  it("never puts a secret on hover when the tooltip is off, and marks it for the table", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "Basic dXNlcjpzZWNyZXQ=", tooltip: false },
    });

    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
    expect(valueSpan(wrapper).attributes("title")).toBeUndefined();
    expect(valueSpan(wrapper).attributes("data-o-tooltip-off")).toBe("");
    expect(valueSpan(wrapper).text()).toBe("Basic dXNlcjpzZWNyZXQ=");
  });

  describe("secret", () => {
    const secret = "Basic dXNlcjpzZWNyZXQ=";
    const mountSecret = () =>
      mount(OCodeCell, { props: { value: secret, secret: true, tooltip: false } });

    it("masks the value by default and keeps the secret out of the DOM", () => {
      const wrapper = mountSecret();
      expect(valueSpan(wrapper).text()).toBe("Basic ••••••••••••");
      expect(wrapper.html()).not.toContain("dXNlcjpzZWNyZXQ=");
    });

    it("reveals and re-hides with the eye toggle", async () => {
      const wrapper = mountSecret();
      await wrapper.get('[data-test="o-code-cell-reveal"]').trigger("click");
      expect(valueSpan(wrapper).text()).toBe(secret);
      await wrapper.get('[data-test="o-code-cell-reveal"]').trigger("click");
      expect(valueSpan(wrapper).text()).toBe("Basic ••••••••••••");
    });

    it("copies the full value while still masked", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const wrapper = mountSecret();
      await wrapper.get('button[title="Copy"]').trigger("click");
      expect(writeText).toHaveBeenCalledWith(secret);
      expect(valueSpan(wrapper).text()).toBe("Basic ••••••••••••");
      vi.unstubAllGlobals();
    });

    it("re-masks when the value changes", async () => {
      const wrapper = mountSecret();
      await wrapper.get('[data-test="o-code-cell-reveal"]').trigger("click");
      await wrapper.setProps({ value: "Basic bmV3OnNlY3JldA==" });
      expect(valueSpan(wrapper).text()).toBe("Basic ••••••••••••");
    });

    it("masks a bare token entirely", () => {
      const wrapper = mount(OCodeCell, { props: { value: "7b3d-uuid", secret: true } });
      expect(valueSpan(wrapper).text()).toBe("••••••••••••");
    });

    it("shows no eye toggle for a non-secret value", () => {
      expect(
        mount(OCodeCell, { props: { value: "abc" } })
          .find('[data-test="o-code-cell-reveal"]')
          .exists(),
      ).toBe(false);
    });
  });
});
