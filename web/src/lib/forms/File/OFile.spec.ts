// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFile from "./OFile.vue";

describe("OFile", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function makeFile(name: string, sizeBytes: number, type = "text/plain") {
    return new File(["x".repeat(sizeBytes)], name, { type });
  }

  it("renders without errors", () => {
    wrapper = mount(OFile);
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='file']").exists()).toBe(true);
  });

  it("renders the label", () => {
    wrapper = mount(OFile, { props: { label: "Attachment" } });
    expect(wrapper.text()).toContain("Attachment");
  });

  it("shows the placeholder when no file is selected", () => {
    wrapper = mount(OFile, { props: { placeholder: "Upload here" } });
    expect(wrapper.text()).toContain("Upload here");
  });

  it("emits update:modelValue with a single file when not multiple", async () => {
    wrapper = mount(OFile, { props: { multiple: false } });
    const file = makeFile("hello.txt", 12);
    const input = wrapper.find("input[type='file']").element as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await wrapper.find("input[type='file']").trigger("change");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBeInstanceOf(File);
    expect((emitted![0][0] as File).name).toBe("hello.txt");
  });

  it("emits an array when multiple is true", async () => {
    wrapper = mount(OFile, { props: { multiple: true } });
    const files = [makeFile("a.txt", 10), makeFile("b.txt", 20)];
    const input = wrapper.find("input[type='file']").element as HTMLInputElement;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await wrapper.find("input[type='file']").trigger("change");
    const emitted = wrapper.emitted("update:modelValue");
    expect(Array.isArray(emitted![0][0])).toBe(true);
    expect((emitted![0][0] as File[]).length).toBe(2);
  });

  it("emits size-error and skips update when a file exceeds maxFileSize", async () => {
    wrapper = mount(OFile, { props: { maxFileSize: 5 } });
    const big = makeFile("big.txt", 100);
    const input = wrapper.find("input[type='file']").element as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    await wrapper.find("input[type='file']").trigger("change");
    expect(wrapper.emitted("size-error")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("clears the selection via the clear button", async () => {
    const file = makeFile("a.txt", 10);
    wrapper = mount(OFile, { props: { modelValue: file } });
    const clearBtn = wrapper.find('[aria-label="Clear all"]');
    expect(clearBtn.exists()).toBe(true);
    await clearBtn.trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted![0][0]).toBe(null);
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("removes a single file via its chip", async () => {
    const files = [makeFile("a.txt", 10), makeFile("b.txt", 20)];
    wrapper = mount(OFile, { props: { modelValue: files, multiple: true } });
    const removeBtn = wrapper.find('[data-test="o-file-chip-0"] button');
    await removeBtn.trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![0][0] as File[];
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("b.txt");
  });

  it("disables the control", () => {
    wrapper = mount(OFile, { props: { disabled: true } });
    expect(
      wrapper.find("input[type='file']").attributes("disabled"),
    ).toBeDefined();
  });

  it("renders the error message", () => {
    wrapper = mount(OFile, { props: { errorMessage: "Required" } });
    expect(wrapper.text()).toContain("Required");
  });
});
