// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import OFile from "./OFile.vue";
import { createJsonFileValidator } from "./validateJsonFile";
import { raw, gt } from "@/types/i18n";

describe("OFile", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function makeFile(name: string, sizeBytes: number, type = "text/plain") {
    return new File(["x".repeat(sizeBytes)], name, { type });
  }

  // FileReader resolves on a macrotask, so a microtask flush alone is not enough.
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
  }

  async function pick(files: File[]) {
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: files, configurable: true });
    await input.trigger("change");
    await settle();
  }

  async function drop(files: File[]) {
    const zone = wrapper.find('[data-test="o-file-zone"]');
    await zone.trigger("dragenter", { dataTransfer: { files } });
    await zone.trigger("drop", { dataTransfer: { files } });
    await flushPromises();
  }

  it("renders a drop zone with a real choose button and its constraints", () => {
    wrapper = mount(OFile, { props: { accept: ".json", maxSize: 5 * 1024 * 1024 } });
    expect(wrapper.find("input[type='file']").exists()).toBe(true);
    expect(wrapper.find('[data-test="o-file-zone"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-file-prompt"]').text()).toBe("Drop a file here");
    expect(wrapper.find('[data-test="o-file-zone"]').text()).toContain("or");
    const btn = wrapper.find('[data-test="o-file-choose-btn"]');
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.text()).toBe("Choose file");
    expect(wrapper.text()).toContain(".json · up to 5.0 MB · one file");
  });

  it("uses the plural prompt and button label when multiple", () => {
    wrapper = mount(OFile, { props: { multiple: true } });
    expect(wrapper.find('[data-test="o-file-prompt"]').text()).toBe("Drop files here");
    expect(wrapper.find('[data-test="o-file-choose-btn"]').text()).toBe("Choose files");
  });

  it("opens the picker when the empty zone is clicked", async () => {
    wrapper = mount(OFile);
    const click = vi.spyOn(wrapper.find("input[type='file']").element as HTMLInputElement, "click");
    const zone = wrapper.find('[data-test="o-file-zone"]');
    expect(zone.classes()).toContain("cursor-pointer");
    await zone.trigger("click");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("opens the picker once when the choose button is clicked", async () => {
    wrapper = mount(OFile);
    const click = vi.spyOn(wrapper.find("input[type='file']").element as HTMLInputElement, "click");
    await wrapper.find('[data-test="o-file-choose-btn"]').trigger("click");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("keeps the button as the only tab stop in the zone", () => {
    wrapper = mount(OFile);
    const zone = wrapper.find('[data-test="o-file-zone"]');
    expect(zone.attributes("tabindex")).toBeUndefined();
    expect(wrapper.find("input[type='file']").attributes("tabindex")).toBe("-1");
    expect(zone.findAll("button")).toHaveLength(1);
  });

  it("hides the or and the button while dragging", async () => {
    wrapper = mount(OFile);
    await wrapper.find('[data-test="o-file-zone"]').trigger("dragenter");
    expect(wrapper.text()).toContain("Drop to upload");
    expect(wrapper.find('[data-test="o-file-choose-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-file-prompt"]').exists()).toBe(false);
  });

  it("shows the disabled reason instead of the prompt and button, and ignores zone clicks", async () => {
    wrapper = mount(OFile, { props: { disabled: true, disabledReason: raw("Upload is off") } });
    const click = vi.spyOn(wrapper.find("input[type='file']").element as HTMLInputElement, "click");
    const zone = wrapper.find('[data-test="o-file-zone"]');
    expect(zone.text()).toContain("Upload is off");
    expect(wrapper.find('[data-test="o-file-prompt"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-file-choose-btn"]').exists()).toBe(false);
    expect(zone.classes()).not.toContain("cursor-pointer");
    await zone.trigger("click");
    expect(click).not.toHaveBeenCalled();
  });

  it("hides the button but keeps the prompt when disabled without a reason", () => {
    wrapper = mount(OFile, { props: { disabled: true } });
    expect(wrapper.find('[data-test="o-file-prompt"]').text()).toBe("Drop a file here");
    expect(wrapper.find('[data-test="o-file-choose-btn"]').exists()).toBe(false);
  });

  it("lets the hint slot replace the prompt, or and button", () => {
    wrapper = mount(OFile, {
      slots: { hint: () => h("span", { "data-test": "custom-hint" }, "Custom") },
    });
    expect(wrapper.find('[data-test="custom-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-file-prompt"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-file-choose-btn"]').exists()).toBe(false);
  });

  it("renders the label", () => {
    wrapper = mount(OFile, { props: { label: raw("Attachment") } });
    expect(wrapper.text()).toContain("Attachment");
  });

  it("shows the compact placeholder when no file is selected", () => {
    wrapper = mount(OFile, { props: { variant: "compact", placeholder: raw("Upload here") } });
    expect(wrapper.text()).toContain("Upload here");
    expect(wrapper.find('[data-test="o-file-choose-btn"]').text()).toBe("Choose file");
  });

  it("emits update:modelValue with a single file when not multiple", async () => {
    wrapper = mount(OFile, { props: { multiple: false } });
    await pick([makeFile("hello.txt", 12)]);
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted![0][0]).toBeInstanceOf(File);
    expect((emitted![0][0] as File).name).toBe("hello.txt");
  });

  it("emits an array when multiple is true", async () => {
    wrapper = mount(OFile, { props: { multiple: true } });
    await pick([makeFile("a.txt", 10), makeFile("b.txt", 20)]);
    const emitted = wrapper.emitted("update:modelValue");
    expect((emitted![0][0] as File[]).length).toBe(2);
  });

  it("accepts files dropped on the zone and shows the drop state while dragging", async () => {
    wrapper = mount(OFile, { props: { multiple: true } });
    const zone = wrapper.find('[data-test="o-file-zone"]');
    await zone.trigger("dragenter");
    expect(wrapper.text()).toContain("Drop to upload");
    await drop([makeFile("dropped.txt", 4)]);
    const emitted = wrapper.emitted("update:modelValue");
    expect((emitted![0][0] as File[])[0].name).toBe("dropped.txt");
    expect(wrapper.text()).not.toContain("Drop to upload");
  });

  it("ignores drops while disabled", async () => {
    wrapper = mount(OFile, { props: { disabled: true, disabledReason: raw("Upload is off") } });
    expect(wrapper.text()).toContain("Upload is off");
    await drop([makeFile("dropped.txt", 4)]);
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find("input[type='file']").attributes("disabled")).toBeDefined();
  });

  it("turns an oversized file into an error row instead of ignoring it", async () => {
    wrapper = mount(OFile, { props: { maxSize: 5 } });
    await pick([makeFile("big.txt", 100)]);
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(null);
    const rejected = wrapper.emitted("rejected")![0][0] as { file: File }[];
    expect(rejected[0].file.name).toBe("big.txt");
    const row = wrapper.find('[data-test="o-file-chip-0"]');
    expect(row.attributes("data-state")).toBe("error");
    expect(row.text()).toContain("100 B is over the 5 B limit");
  });

  it("rejects a file of the wrong type with a row naming the accepted types", async () => {
    wrapper = mount(OFile, { props: { accept: ".json", multiple: true } });
    await pick([makeFile("ok.json", 2, "application/json"), makeFile("notes.txt", 2)]);
    expect((wrapper.emitted("update:modelValue")![0][0] as File[]).map((f) => f.name)).toEqual([
      "ok.json",
    ]);
    expect(wrapper.find('[data-test="o-file-chip-0"]').text()).toContain(
      "Only .json files are accepted",
    );
  });

  it("rejects files past maxFiles", async () => {
    wrapper = mount(OFile, { props: { multiple: true, maxFiles: 1 } });
    await pick([makeFile("a.txt", 1), makeFile("b.txt", 1)]);
    expect((wrapper.emitted("update:modelValue")![0][0] as File[]).length).toBe(1);
    expect(wrapper.find('[data-test="o-file-chip-0"]').text()).toContain("Only 1 file at a time");
  });

  it("shows the validator's message on the row", async () => {
    wrapper = mount(OFile, { props: { validate: createJsonFileValidator(gt) } });
    await pick([new File(["{ nope"], "bad.json", { type: "application/json" })]);
    expect(wrapper.find('[data-test="o-file-chip-0"]').text()).toContain("Not valid JSON");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(null);
  });

  it("dismisses an error row with its remove button", async () => {
    wrapper = mount(OFile, { props: { maxSize: 1 } });
    await pick([makeFile("big.txt", 10)]);
    await wrapper.find('[data-test="o-file-chip-0-remove-btn"]').trigger("click");
    expect(wrapper.find('[data-test="o-file-chip-0"]').exists()).toBe(false);
  });

  it("removes the only file and emits clear", async () => {
    const file = makeFile("a.txt", 10);
    wrapper = mount(OFile, { props: { modelValue: file } });
    const removeBtn = wrapper.find('[data-test="o-file-chip-0-remove-btn"]');
    expect(removeBtn.attributes("aria-label")).toBe("Remove a.txt");
    await removeBtn.trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(null);
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("removes a single file via its row", async () => {
    const files = [makeFile("a.txt", 10), makeFile("b.txt", 20)];
    wrapper = mount(OFile, { props: { modelValue: files, multiple: true } });
    await wrapper.find('[data-test="o-file-chip-0"] button').trigger("click");
    const next = wrapper.emitted("update:modelValue")![0][0] as File[];
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("b.txt");
  });

  it("drives row progress from the upload callback", async () => {
    let report: (fraction: number) => void = () => {};
    let finish: () => void = () => {};
    const upload = (_file: File, onProgress: (fraction: number) => void) =>
      new Promise<void>((resolve) => {
        report = onProgress;
        finish = resolve;
      });
    wrapper = mount(OFile, { props: { upload } });
    await pick([makeFile("a.txt", 10)]);
    await wrapper.setProps({ modelValue: wrapper.emitted("update:modelValue")![0][0] as File });
    report(0.64);
    await flushPromises();
    const row = wrapper.find('[data-test="o-file-chip-0"]');
    expect(row.attributes("data-state")).toBe("uploading");
    expect(row.text()).toContain("64%");
    finish();
    await flushPromises();
    expect(wrapper.find('[data-test="o-file-chip-0"]').attributes("data-state")).toBe("done");
  });

  it("shows an upload failure on the row", async () => {
    const upload = () => Promise.reject(new Error("boom"));
    wrapper = mount(OFile, { props: { upload } });
    await pick([makeFile("a.txt", 10)]);
    await wrapper.setProps({ modelValue: wrapper.emitted("update:modelValue")![0][0] as File });
    await flushPromises();
    expect(wrapper.find('[data-test="o-file-chip-0"]').text()).toContain("Upload failed");
  });

  it("switches sources inside one fixed-height area", async () => {
    wrapper = mount(OFile, { props: { sources: ["file", "url", "paste"] } });
    expect(wrapper.find('[data-test="o-file-source"]').exists()).toBe(true);
    const area = wrapper.find('[data-test="o-file-zone"]').element.parentElement!;
    expect(area.className).toContain("h-43");
    await wrapper.find('[data-test="o-file-source-url"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:source")![0][0]).toBe("url");
    expect(wrapper.find('[data-test="o-file-zone"]').exists()).toBe(false);
    const url = wrapper.find('[data-test="o-file-url-field"]');
    expect(url.element.closest(".h-43")).toBe(area);
    await url.setValue("https://example.com/a.json");
    expect(wrapper.emitted("update:url")!.at(-1)![0]).toBe("https://example.com/a.json");
  });

  it("hides the source switch with a single source", () => {
    wrapper = mount(OFile);
    expect(wrapper.find('[data-test="o-file-source"]').exists()).toBe(false);
  });

  it("renders the error message", () => {
    wrapper = mount(OFile, { props: { errorMessage: raw("Required") } });
    expect(wrapper.text()).toContain("Required");
  });
});
