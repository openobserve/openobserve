// Copyright 2026 OpenObserve Inc.
//
// The behaviour under test is the sticky auto-fill: the icon tracks the folder
// name while it is still auto-picked, and freezes the moment the user chooses.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import FolderIconField from "./FolderIconField.vue";

const Host = defineComponent({
  props: { startTouched: { type: Boolean, default: false } },
  setup(props) {
    return () =>
      h(
        OForm,
        { defaultValues: { name: "", description: "", icon: null } },
        {
          default: () => [
            h(OFormInput, { name: "name", "data-test": "name-input" }),
            h(FolderIconField, { startTouched: props.startTouched }),
          ],
        },
      );
  },
});

function currentIcon(wrapper: VueWrapper): string {
  return wrapper.find('[data-test="emoji-picker-trigger"]').text();
}

async function typeName(wrapper: VueWrapper, value: string) {
  await wrapper.find("input").setValue(value);
  await nextTick();
  await nextTick();
}

/** Open the panel and click a catalog option by its first keyword. */
async function pickEmoji(wrapper: VueWrapper, keyword: string) {
  await wrapper.find('[data-test="emoji-picker-trigger"]').trigger("click");
  await nextTick();
  await nextTick();
  document
    .querySelector<HTMLButtonElement>(`[data-test="emoji-picker-option-${keyword}"]`)
    ?.click();
  await nextTick();
  await nextTick();
}

describe("FolderIconField", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should start with no icon", () => {
    wrapper = mount(Host, { attachTo: document.body });
    expect(currentIcon(wrapper)).toBe("");
  });

  it("should auto-fill the icon from the folder name", async () => {
    wrapper = mount(Host, { attachTo: document.body });
    await typeName(wrapper, "production");
    expect(currentIcon(wrapper)).toBe("🚀");
  });

  it("should keep following the name while the icon is still auto-picked", async () => {
    wrapper = mount(Host, { attachTo: document.body });
    await typeName(wrapper, "production");
    expect(currentIcon(wrapper)).toBe("🚀");
    await typeName(wrapper, "security");
    expect(currentIcon(wrapper)).toBe("🔒");
  });

  it("should stop following the name once the user picks an icon", async () => {
    wrapper = mount(Host, { attachTo: document.body });
    await typeName(wrapper, "production");
    expect(currentIcon(wrapper)).toBe("🚀");

    await pickEmoji(wrapper, "database");
    expect(currentIcon(wrapper)).toBe("🗄️");

    // The name now says "security", but the user's pick must survive it.
    await typeName(wrapper, "security");
    expect(currentIcon(wrapper)).toBe("🗄️");
  });

  it("should stay frozen after the user deliberately clears the icon", async () => {
    wrapper = mount(Host, { attachTo: document.body });
    await typeName(wrapper, "production");

    await wrapper.find('[data-test="emoji-picker-trigger"]').trigger("click");
    await nextTick();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[data-test="emoji-picker-clear"]')?.click();
    await nextTick();
    await nextTick();
    expect(currentIcon(wrapper)).toBe("");

    await typeName(wrapper, "database");
    expect(currentIcon(wrapper)).toBe("");
  });

  it("should never auto-fill when it starts touched (editing an iconed folder)", async () => {
    wrapper = mount(Host, { props: { startTouched: true }, attachTo: document.body });
    await typeName(wrapper, "production");
    expect(currentIcon(wrapper)).toBe("");
  });

  it("should clear the icon again when the name is emptied", async () => {
    wrapper = mount(Host, { attachTo: document.body });
    await typeName(wrapper, "production");
    expect(currentIcon(wrapper)).toBe("🚀");
    await typeName(wrapper, "");
    expect(currentIcon(wrapper)).toBe("");
  });
});
