// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AlertUnsavedChanges from "./AlertUnsavedChanges.vue";

const changes = [
  { path: "trigger_condition.threshold", before: 3, after: 7 },
  { path: "trigger_condition.period", before: 10, after: 15 },
];

describe("AlertUnsavedChanges", () => {
  it("counts the changed fields", () => {
    const wrapper = mount(AlertUnsavedChanges, { props: { changes } });
    expect(wrapper.find('[data-test="add-alert-unsaved-count"]').text()).toBe("2 unsaved changes");
  });

  it("uses the singular for one change", () => {
    const wrapper = mount(AlertUnsavedChanges, { props: { changes: changes.slice(0, 1) } });
    expect(wrapper.find('[data-test="add-alert-unsaved-count"]').text()).toBe("1 unsaved change");
  });

  it("renders nothing when the form matches the saved alert", () => {
    const wrapper = mount(AlertUnsavedChanges, { props: { changes: [] } });
    expect(wrapper.find('[data-test="add-alert-unsaved"]').exists()).toBe(false);
  });

  it("asks the host to discard", async () => {
    const wrapper = mount(AlertUnsavedChanges, { props: { changes } });
    await wrapper.find('[data-test="add-alert-discard-btn"]').trigger("click");
    expect(wrapper.emitted("discard")).toHaveLength(1);
  });
});
