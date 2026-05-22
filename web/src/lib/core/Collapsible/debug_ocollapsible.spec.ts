import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, computed, ref, h } from "vue";
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui";

// Minimal reproduction of OCollapsible's approach
const MinimalCollapsible = defineComponent({
  props: {
    defaultOpen: { type: Boolean, default: false },
    modelValue: { type: Boolean, default: undefined },
  },
  setup(props) {
    const internalOpen = ref(props.defaultOpen);
    const isOpen = computed(() => {
      if (props.modelValue !== undefined) return props.modelValue;
      return internalOpen.value;
    });
    function handleOpenChange(v: boolean) {
      internalOpen.value = v;
    }
    return { isOpen, handleOpenChange };
  },
  template: `
    <CollapsibleRoot :open="isOpen" @update:open="handleOpenChange">
      <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      <CollapsibleContent>Content</CollapsibleContent>
    </CollapsibleRoot>
  `,
  components: { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent },
});

describe("debug minimal collapsible", () => {
  it("defaultOpen=true", () => {
    const wrapper = mount(MinimalCollapsible, { props: { defaultOpen: true } });
    expect(wrapper.html()).toBe("IMPOSSIBLE");
  });

  it("defaultOpen=false", () => {
    const wrapper = mount(MinimalCollapsible, { props: { defaultOpen: false } });
    expect(wrapper.html()).toBe("IMPOSSIBLE2");
  });
});
