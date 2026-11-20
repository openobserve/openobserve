// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OSecretCell from "./OSecretCell.vue";

const SECRET = "Basic c2VjcmV0LXRva2Vu";

describe("OSecretCell", () => {
  it("keeps the secret out of the DOM until it is revealed", async () => {
    const wrapper = mount(OSecretCell, { props: { value: SECRET, mask: "Basic ••••••••" } });

    expect(wrapper.html()).not.toContain("c2VjcmV0");
    expect(wrapper.text()).toContain("Basic ••••••••");

    await wrapper.find('[data-test="o-secret-cell-reveal"]').trigger("click");
    expect(wrapper.text()).toContain(SECRET);

    await wrapper.find('[data-test="o-secret-cell-reveal"]').trigger("click");
    expect(wrapper.html()).not.toContain("c2VjcmV0");
  });

  it("copies the real value while masked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mount(OSecretCell, { props: { value: SECRET } });

    await wrapper.find('[data-test="o-secret-cell-copy"]').trigger("click");

    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it("shows the empty label and no actions without a value", () => {
    const wrapper = mount(OSecretCell, { props: { value: null } });

    expect(wrapper.text()).toBe("—");
    expect(wrapper.find("button").exists()).toBe(false);
  });
});
