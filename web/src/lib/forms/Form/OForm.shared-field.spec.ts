// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h, ref } from "vue";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

// Two OForm* wrappers may share one `name` — the anomaly sensitivity row binds a
// tier toggle and an exact-value input to a single `threshold` field.
describe("OForm — two wrappers bound to one field name", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const tiers = [99, 97, 95];

  function mountShared(initial: number, showInput = ref(true)) {
    return mount(OForm, {
      props: { defaultValues: { threshold: initial } },
      slots: {
        default: () => [
          h(OFormToggleGroup, { name: "threshold" }, () =>
            tiers.map((v) => h(OToggleGroupItem, { value: v, key: v }, () => String(v))),
          ),
          showInput.value
            ? h(OFormInput, {
                name: "threshold",
                type: "number",
                modelModifiers: { number: true },
              })
            : null,
        ],
      },
    });
  }

  it("renders the same value in both wrappers", () => {
    wrapper = mountShared(97);
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(input.value).toBe("97");
    const active = wrapper
      .findAll("[data-otoggle-value]")
      .filter((b) => b.attributes("data-state") === "on");
    expect(active).toHaveLength(1);
    expect(active[0].text()).toBe("97");
  });

  it("propagates a toggle selection to the input", async () => {
    wrapper = mountShared(97);
    const items = wrapper.findAll("[data-otoggle-value]");
    await items[2].trigger("click");
    await flushPromises();
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(input.value).toBe("95");
  });

  it("propagates a typed value to the toggle selection", async () => {
    wrapper = mountShared(97);
    const input = wrapper.find("input");
    await input.setValue("99");
    await flushPromises();
    const active = wrapper
      .findAll("[data-otoggle-value]")
      .filter((b) => b.attributes("data-state") === "on");
    expect(active).toHaveLength(1);
    expect(active[0].text()).toBe("99");
  });

  it("leaves no tier active for a value matching no item", async () => {
    wrapper = mountShared(97);
    await wrapper.find("input").setValue("88");
    await flushPromises();
    const items = wrapper.findAll("[data-otoggle-value]");
    // Sanity: an empty group would satisfy "none active" just as well.
    expect(items).toHaveLength(3);
    expect(items.filter((b) => b.attributes("data-state") === "on")).toHaveLength(0);
  });

  // Per-instance unmount cleanup must not wipe a field a sibling still binds.
  it("keeps the field value when one of the two wrappers unmounts", async () => {
    const showInput = ref(true);
    wrapper = mountShared(97, showInput);
    // Set via the toggle, not the input: this test is about unmount cleanup, and
    // typing would couple it to the modelModifiers forwarding fix.
    await wrapper.findAll("[data-otoggle-value]")[2].trigger("click");
    await flushPromises();

    showInput.value = false;
    await flushPromises();

    expect(wrapper.find("input").exists()).toBe(false);
    const active = wrapper
      .findAll("[data-otoggle-value]")
      .filter((b) => b.attributes("data-state") === "on");
    expect(active).toHaveLength(1);
    expect(active[0].text()).toBe("95");
  });
});
