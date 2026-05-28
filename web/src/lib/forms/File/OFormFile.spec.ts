// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormFile from "./OFormFile.vue";
import OForm from "../Form/OForm.vue";

describe("OFormFile", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function makeFile(name: string, sizeBytes: number) {
    return new File(["x".repeat(sizeBytes)], name, { type: "text/plain" });
  }

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { resume: null as File | null } },
      slots: {
        default: () => h(OFormFile, { name: "resume", label: "Resume" }),
      },
      global: { components: { OFormFile } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='file']").exists()).toBe(true);
  });

  it("shows validator error after selection", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { resume: null as File | null } },
      slots: {
        default: () =>
          h(OFormFile, {
            name: "resume",
            validators: [
              (v: File | File[] | null) => (v ? undefined : "Required"),
              (v: File | File[] | null) => {
                if (!v) return undefined;
                const f = Array.isArray(v) ? v[0] : v;
                return f.size > 50 ? "Too big" : undefined;
              },
            ],
          }),
      },
      global: { components: { OFormFile } },
    });
    const input = wrapper.find("input[type='file']")
      .element as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("a.txt", 100)],
      configurable: true,
    });
    await wrapper.find("input[type='file']").trigger("change");
    await flushPromises();
    expect(wrapper.text()).toContain("Too big");
  });
});
