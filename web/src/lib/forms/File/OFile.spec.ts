// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import OFile from "./OFile.vue";
import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";
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

  it("renders a drop zone with one prompt line, a browse link and the file types", () => {
    wrapper = mount(OFile, { props: { accept: ".json", maxSize: 5 * 1024 * 1024 } });
    expect(wrapper.find("input[type='file']").exists()).toBe(true);
    const zone = wrapper.find('[data-test="o-file-zone"]');
    expect(zone.exists()).toBe(true);
    expect(wrapper.find('[data-test="o-file-prompt"]').text()).toBe(
      "Drop a file to attach, or browse",
    );
    expect(wrapper.find('[data-test="o-file-types"]').text()).toBe("File supported .json");
    const btn = wrapper.find('[data-test="o-file-choose-btn"]');
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.attributes("type")).toBe("button");
    expect(btn.text()).toBe("browse");
    // The zone names the file types only: no size or file count.
    expect(zone.text()).not.toContain("MB");
    expect(zone.text()).not.toContain("one file");
  });

  it("joins several file types with commas and a final &", () => {
    wrapper = mount(OFile, { props: { accept: ".png, .jpg, .webp" } });
    expect(wrapper.find('[data-test="o-file-types"]').text()).toBe(
      "File supported .png, .jpg & .webp",
    );
  });

  it("leaves out the file types line when nothing is accepted in particular", () => {
    wrapper = mount(OFile);
    expect(wrapper.find('[data-test="o-file-types"]').exists()).toBe(false);
  });

  it("uses the plural prompt when multiple", () => {
    wrapper = mount(OFile, { props: { multiple: true } });
    expect(wrapper.find('[data-test="o-file-prompt"]').text()).toBe(
      "Drop files to attach, or browse",
    );
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

  it("hides the prompt and the browse link while dragging", async () => {
    wrapper = mount(OFile);
    await wrapper.find('[data-test="o-file-zone"]').trigger("dragenter");
    expect(wrapper.text()).toContain("Drop the file to attach");
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

  it("says upload is unavailable, with no drop prompt, when disabled without a reason", () => {
    wrapper = mount(OFile, { props: { disabled: true, accept: ".json" } });
    expect(wrapper.find('[data-test="o-file-disabled"]').text()).toBe("File upload is unavailable");
    expect(wrapper.find('[data-test="o-file-prompt"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-file-choose-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-file-types"]').exists()).toBe(false);
  });

  it("renders the label", () => {
    wrapper = mount(OFile, { props: { label: raw("Attachment") } });
    expect(wrapper.text()).toContain("Attachment");
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
    expect(wrapper.text()).toContain("Drop the files to attach");
    await drop([makeFile("dropped.txt", 4)]);
    const emitted = wrapper.emitted("update:modelValue");
    expect((emitted![0][0] as File[])[0].name).toBe("dropped.txt");
    expect(wrapper.text()).not.toContain("Drop the files to attach");
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

  describe("inside a dialog", () => {
    const inDialog = (props: Record<string, unknown> = {}) =>
      mount(OFile, {
        props: { accept: ".csv", ...props },
        global: { provide: { [DIALOG_DEPTH_KEY]: 1 } },
      });

    it("keeps an empty space in place of the file row before anything is picked", () => {
      wrapper = inDialog();
      const space = wrapper.find('[data-test="o-file-empty-row"]');
      expect(space.exists()).toBe(true);
      expect(space.text()).toBe("");
    });

    it("shows the field's own error inside the kept space, not on a new line", () => {
      wrapper = inDialog({ errorMessage: raw("CSV File is required!") });
      expect(wrapper.find('[data-test="o-file-empty-row"]').text()).toBe("CSV File is required!");
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    });

    it("swaps the empty row for the rejection row instead of adding one", async () => {
      wrapper = inDialog();
      await pick([makeFile("notes.txt", 2)]);
      expect(wrapper.find('[data-test="o-file-empty-row"]').exists()).toBe(false);
      expect(wrapper.findAll('[data-test^="o-file-chip-"][data-state]')).toHaveLength(1);
    });

    it("still shows the field's error under a picked file, but not under a rejection row", async () => {
      wrapper = inDialog({ errorMessage: raw("Server refused the file") });
      await wrapper.setProps({ modelValue: makeFile("ok.csv", 2, "text/csv") });
      expect(wrapper.find('[role="alert"]').text()).toBe("Server refused the file");
      await wrapper.setProps({ modelValue: null });
      await pick([makeFile("notes.txt", 2)]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it("does not reserve the row for multi-file uploads or outside a dialog", () => {
      wrapper = inDialog({ multiple: true });
      expect(wrapper.find('[data-test="o-file-empty-row"]').exists()).toBe(false);
      wrapper.unmount();
      wrapper = mount(OFile, { props: { accept: ".csv" } });
      expect(wrapper.find('[data-test="o-file-empty-row"]').exists()).toBe(false);
    });
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

  it("renders the error message", () => {
    wrapper = mount(OFile, { props: { errorMessage: raw("Required") } });
    expect(wrapper.text()).toContain("Required");
  });

  it("keeps the newest pick when an older, slower check finishes last", async () => {
    let releaseSlow: () => void = () => {};
    const validate = vi.fn((file: File) =>
      file.name === "slow.json"
        ? new Promise<null>((resolve) => (releaseSlow = () => resolve(null)))
        : null,
    );
    wrapper = mount(OFile, { props: { validate } });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", {
      value: [makeFile("slow.json", 2)],
      configurable: true,
    });
    await input.trigger("change");
    Object.defineProperty(input.element, "files", {
      value: [makeFile("fast.json", 2)],
      configurable: true,
    });
    await input.trigger("change");
    await settle();
    releaseSlow();
    await settle();
    const picks = wrapper.emitted("update:modelValue")!.map((e) => (e[0] as File).name);
    expect(picks).toEqual(["fast.json"]);
  });

  it("ends the drag state when the pointer leaves the zone, even after its content swapped", async () => {
    wrapper = mount(OFile, { attachTo: document.body });
    const zone = wrapper.find('[data-test="o-file-zone"]');
    const leave = (to: Element) =>
      zone.element.dispatchEvent(
        Object.assign(new Event("dragleave", { bubbles: true }), { relatedTarget: to }),
      );
    await zone.trigger("dragenter");
    leave(zone.element.firstElementChild!);
    await flushPromises();
    expect(wrapper.text()).toContain("Drop the file to attach");
    // A swapped-out child never sends its dragleave: two enters, then one real exit.
    await zone.trigger("dragenter");
    leave(document.body);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Drop the file to attach");
  });

  it("names the browse button after the field and points it at the field error", () => {
    wrapper = mount(OFile, {
      props: { label: raw("Select File"), errorMessage: raw("Pick a file") },
    });
    const btn = wrapper.find('[data-test="o-file-choose-btn"]');
    const ids = btn.attributes("aria-labelledby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(wrapper.find(`#${ids[0]}`).text()).toBe("Select File");
    expect(btn.attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(`#${btn.attributes("aria-describedby")}`).text()).toBe("Pick a file");
  });

  it("uses an aria-label as the field name instead of putting it on the wrapper", () => {
    wrapper = mount(OFile, { attrs: { "aria-label": "Custom logo (light mode)" } });
    expect(wrapper.attributes("aria-label")).toBeUndefined();
    expect(wrapper.find("input[type='file']").attributes("aria-label")).toBe(
      "Custom logo (light mode)",
    );
    const nameId = wrapper
      .find('[data-test="o-file-choose-btn"]')
      .attributes("aria-labelledby")!
      .split(" ")[0];
    expect(wrapper.find(`#${nameId}`).text()).toBe("Custom logo (light mode)");
  });
});
