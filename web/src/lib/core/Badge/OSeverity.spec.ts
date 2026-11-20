// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSeverity from "./OSeverity.vue";
import { raw } from "@/types/i18n";
import { toSeverityLevel } from "./severityLevel";

describe("OSeverity", () => {
  it("renders the level word in mono text", () => {
    const w = mount(OSeverity, { props: { level: "error" } });
    expect(w.text()).toBe("error");
    expect(w.find(".font-mono").classes()).toContain("text-badge-error-soft-text");
  });

  it("colours fatal as critical and debug as tertiary", () => {
    expect(mount(OSeverity, { props: { level: "fatal" } }).html()).toContain(
      "text-badge-purple-soft-text",
    );
    expect(mount(OSeverity, { props: { level: "debug" } }).html()).toContain("text-text-muted");
  });

  it("renders the 3 px mark only when asked", () => {
    expect(
      mount(OSeverity, { props: { level: "warn" } })
        .find('[data-test="o-severity-mark"]')
        .exists(),
    ).toBe(false);
    const mark = mount(OSeverity, { props: { level: "warn", mark: true } }).find(
      '[data-test="o-severity-mark"]',
    );
    expect(mark.classes()).toContain("bg-badge-warning-solid-bg");
    expect(mark.attributes("aria-hidden")).toBe("true");
  });

  it("takes a label override", () => {
    const w = mount(OSeverity, { props: { level: "warn", label: raw("warning") } });
    expect(w.text()).toBe("warning");
  });
});

describe("toSeverityLevel", () => {
  it("folds syslog and OTel words onto the five levels", () => {
    expect(toSeverityLevel("ERROR")).toBe("error");
    expect(toSeverityLevel("Warning")).toBe("warn");
    expect(toSeverityLevel("critical")).toBe("fatal");
    expect(toSeverityLevel("trace")).toBe("debug");
    expect(toSeverityLevel("notice")).toBe("info");
    expect(toSeverityLevel("whatever")).toBe("info");
  });
});
