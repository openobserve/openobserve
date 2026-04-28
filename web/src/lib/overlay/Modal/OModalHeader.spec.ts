import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OModal from "./OModal.vue";
import OModalHeader from "./OModalHeader.vue";

// Same portal mock as OModal.spec.ts
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DialogPortal: actual.DialogContent, // render inline
  };
});

function mountHeaderInModal(
  headerProps: Record<string, unknown> = {},
  headerSlots: Record<string, () => unknown> = {}
) {
  return mount(OModal, {
    props: { open: true },
    slots: {
      default: () => h(OModalHeader, headerProps, headerSlots),
    },
  });
}

describe("OModalHeader", () => {
  it("renders slot content as the title", () => {
    const wrapper = mountHeaderInModal({}, { default: () => "My Dialog" });
    expect(wrapper.text()).toContain("My Dialog");
  });

  it("shows close button by default", () => {
    const wrapper = mountHeaderInModal();
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("hides close button when showClose=false", () => {
    const wrapper = mountHeaderInModal({ showClose: false });
    // DialogTitle renders as div/h2, no button when showClose=false
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("emits close when close button is clicked", async () => {
    const onClose = vi.fn();
    const wrapper = mount(OModal, {
      props: { open: true },
      slots: {
        default: () => h(OModalHeader, { onClose }),
      },
    });
    await wrapper.find("button").trigger("click");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders custom close icon via close slot", () => {
    const wrapper = mountHeaderInModal(
      {},
      { close: () => h("span", { "data-testid": "custom-icon" }) }
    );
    expect(wrapper.find('[data-testid="custom-icon"]').exists()).toBe(true);
  });

  it("has border-bottom for visual separation", () => {
    const wrapper = mountHeaderInModal();
    const header = wrapper.find(".tw\\:border-b");
    expect(header.exists()).toBe(true);
  });
});
