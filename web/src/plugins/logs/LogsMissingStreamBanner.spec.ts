// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { raw } from "@/types/i18n";
import LogsMissingStreamBanner from "./LogsMissingStreamBanner.vue";

describe("LogsMissingStreamBanner recovery layout", () => {
  it("separates actions and the permission reason and opens the form below them", async () => {
    const wrapper = mount(LogsMissingStreamBanner, {
      props: {
        message: raw(""),
        noFtsStreams: ["nofts"],
        configureDenied: true,
        recoveryStreams: [{ name: "nofts", schema: [{ name: "message", type: "Utf8" }] }],
      },
      global: { plugins: [i18n, router], provide: { store } },
    });
    const action = wrapper.get('[data-test="logs-no-fts-search-fields-btn"]');
    const configure = wrapper.get('[data-test="logs-no-fts-configure-btn"]');
    expect(action.element.parentElement?.classList.contains("gap-2")).toBe(true);
    const permissionId = configure.attributes("aria-describedby");
    expect(
      configure.element.parentElement?.querySelector(`[id="${permissionId}"]`)?.textContent,
    ).toContain("You need permission");
    await action.trigger("click");
    await flushPromises();
    const form = wrapper.getComponent({ name: "LogsNoFtsFieldSearch" });
    expect(
      configure.element.compareDocumentPosition(form.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(form.element.parentElement).toBe(action.element.parentElement?.parentElement);
    wrapper.unmount();
  });
});
