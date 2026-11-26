import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import LogoUploadCard from "./LogoUploadCard.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const base = {
  title: raw("Custom logo (light mode)"),
  description: raw("Shown in light mode."),
  currentSrc: null as string | null,
  modelValue: null as File | null,
  dataTest: "logo",
};

describe("LogoUploadCard", () => {
  let wrapper: VueWrapper;

  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:picked");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => wrapper?.unmount());

  const mountCard = (props: Partial<typeof base> & { surface?: "light" | "dark" } = {}) =>
    (wrapper = mount(LogoUploadCard, {
      props: { ...base, ...props },
      global: { plugins: [i18n] },
    }));

  it("shows the drop box and no status while nothing is saved or picked", () => {
    mountCard();
    expect(wrapper.find('[data-test="logo_file_upload-zone"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-test="logo_preview"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="logo_status"]').exists()).toBe(false);
  });

  it("previews a saved logo as Saved, and Remove asks the page to remove it", async () => {
    mountCard({ currentSrc: "data:image/png;base64,aGVsbG8=" });
    expect(wrapper.find('[data-test="logo"]').attributes("src")).toContain("aGVsbG8=");
    expect(wrapper.find('[data-test="logo_status"]').text()).toBe("Saved");
    expect(wrapper.find('[data-test="logo_file_upload-zone"]').isVisible()).toBe(false);
    await wrapper.find('[data-test="logo_delete_btn"]').trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("previews a picked file as Not saved, and Remove only drops the pick", async () => {
    const file = new File(["x"], "acme.png", { type: "image/png" });
    mountCard({ currentSrc: "data:image/png;base64,aGVsbG8=", modelValue: file });
    expect(wrapper.find('[data-test="logo"]').attributes("src")).toBe("blob:picked");
    expect(wrapper.find('[data-test="logo_status"]').text()).toBe("Not saved");
    expect(wrapper.text()).toContain("acme.png");
    await wrapper.find('[data-test="logo_delete_btn"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([null]);
    expect(wrapper.emitted("remove")).toBeUndefined();
  });

  it("puts the dark logo on the dark preview background", () => {
    mountCard({ surface: "dark", currentSrc: "data:image/png;base64,aGVsbG8=" });
    expect(wrapper.find('[data-test="logo_preview"]').classes()).toContain(
      "bg-logo-preview-dark-bg",
    );
  });
});
