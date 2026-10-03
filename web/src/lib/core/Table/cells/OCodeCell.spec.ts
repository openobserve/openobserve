// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCodeCell from "./OCodeCell.vue";
import { raw } from "@/types/i18n";

const valueSpan = (wrapper: ReturnType<typeof mount>) => wrapper.find("span.font-mono");

describe("OCodeCell", () => {
  it("shows the full value on hover by default", () => {
    const wrapper = mount(OCodeCell, { props: { value: "trace-0123456789" } });

    expect(valueSpan(wrapper).attributes("title")).toBe("trace-0123456789");
  });

  it("shows the given text on hover in place of the value", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "abc", tooltip: raw("Full value: abc-def") },
    });

    expect(valueSpan(wrapper).attributes("title")).toBe("Full value: abc-def");
  });

  it("never puts a secret on hover when the tooltip is off", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "Basic dXNlcjpzZWNyZXQ=", tooltip: false },
    });

    expect(valueSpan(wrapper).attributes("title")).toBeUndefined();
    expect(valueSpan(wrapper).text()).toBe("Basic dXNlcjpzZWNyZXQ=");
  });
});
