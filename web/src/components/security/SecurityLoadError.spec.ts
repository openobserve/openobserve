import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import SecurityLoadError from "./SecurityLoadError.vue";

describe("SecurityLoadError", () => {
  it("names what failed, says what to do and offers Retry", async () => {
    const w = mount(SecurityLoadError, {
      props: { what: "cases", hint: "Check Sources." },
      global: { plugins: [store], provide: { store } },
    });
    expect(w.text()).toContain("Couldn't load cases");
    expect(w.text()).toContain("Check Sources.");
    await w.find("button").trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });
});
