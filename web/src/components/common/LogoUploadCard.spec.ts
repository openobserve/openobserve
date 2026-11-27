import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
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

  const mountCard = (
    props: Partial<typeof base> & { surface?: "light" | "dark"; disabled?: boolean } = {},
  ) =>
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

  describe("checking that a picked file is a real image", () => {
    // jsdom never decodes images, so the browser's load / error outcome is stood in for.
    const decodes = (ok: boolean) =>
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(_url: string) {
            queueMicrotask(() => (ok ? this.onload?.() : this.onerror?.()));
          }
        },
      );
    const pick = async (file: File) => {
      const input = wrapper.find("input[type='file']");
      Object.defineProperty(input.element, "files", { value: [file], configurable: true });
      await input.trigger("change");
      for (let i = 0; i < 5; i++) await flushPromises();
    };

    afterEach(() => vi.unstubAllGlobals());

    it("takes a file the browser can decode", async () => {
      decodes(true);
      mountCard();
      const file = new File(["x"], "acme.png", { type: "image/png" });
      await pick(file);
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([file]);
    });

    it("refuses a renamed non-image with an error row instead of a broken preview", async () => {
      decodes(false);
      mountCard();
      await pick(new File(["not an image"], "notes.png", { type: "image/png" }));
      expect(wrapper.emitted("update:modelValue")).toEqual([[null]]);
      expect(wrapper.find('[data-test="o-file-chip-0"]').text()).toContain(
        "Not a valid image file",
      );
    });
  });

  it("shows the reason instead of the drop prompt while disabled", () => {
    wrapper = mount(LogoUploadCard, {
      props: {
        ...base,
        disabled: true,
        disabledReason: raw("Available in OpenObserve Enterprise"),
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find('[data-test="logo_file_upload-disabled"]').text()).toBe(
      "Available in OpenObserve Enterprise",
    );
    expect(wrapper.find('[data-test="logo_file_upload-prompt"]').exists()).toBe(false);
  });

  it("takes no dropped file while disabled, e.g. when branding is locked", async () => {
    mountCard({ disabled: true });
    const zone = wrapper.find('[data-test="logo_file_upload-zone"]');
    const files = [new File(["x"], "acme.png", { type: "image/png" })];
    await zone.trigger("dragenter", { dataTransfer: { files } });
    await zone.trigger("drop", { dataTransfer: { files } });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
