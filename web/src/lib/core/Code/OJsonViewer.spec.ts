// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

const copyMock = vi.fn().mockResolvedValue(true);
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));

import OJsonViewer from "./OJsonViewer.vue";

const record = {
  service: "payments-api",
  status: 502,
  retry: true,
  user: null,
  http: { method: "POST", route: "/checkout", headers: { a: "1" } },
  tags: ["a", "b"],
};

const row = (w: ReturnType<typeof mount>, path: string) =>
  w.find(`[data-test="o2-json-viewer-row-${path}"]`);

describe("OJsonViewer", () => {
  it("renders keys in secondary text and colours values by type", () => {
    const w = mount(OJsonViewer, { props: { value: record } });
    expect(row(w, "service").text()).toContain('"payments-api"');
    expect(row(w, "service").find(".text-syntax-string").exists()).toBe(true);
    expect(row(w, "status").find(".text-syntax-number").exists()).toBe(true);
    expect(row(w, "retry").find(".text-syntax-keyword").exists()).toBe(true);
    expect(row(w, "user").find(".text-text-muted").exists()).toBe(true);
    expect(row(w, "service").find(".text-text-secondary").text()).toBe("service:");
  });

  it("opens two levels by default and summarises a collapsed object", async () => {
    const w = mount(OJsonViewer, { props: { value: record } });
    expect(row(w, "http.method").exists()).toBe(true);
    expect(row(w, "http.headers.a").exists()).toBe(false);
    expect(row(w, "http.headers").text()).toContain("1 field");
    await w.find('[data-test="o2-json-viewer-row-http.headers-toggle"]').trigger("click");
    expect(row(w, "http.headers.a").exists()).toBe(true);
  });

  it("builds array paths with indexes", () => {
    const w = mount(OJsonViewer, { props: { value: record } });
    expect(row(w, "tags[1]").text()).toContain('"b"');
  });

  it("offers include and exclude only when listened to, with the row's path and value", async () => {
    const plain = mount(OJsonViewer, { props: { value: record } });
    expect(plain.find('[data-test="o2-json-viewer-row-status-include"]').exists()).toBe(false);

    const onInclude = vi.fn();
    const onExclude = vi.fn();
    const w = mount(OJsonViewer, { props: { value: record, onInclude, onExclude } });
    await w.find('[data-test="o2-json-viewer-row-http.method-include"]').trigger("click");
    await w.find('[data-test="o2-json-viewer-row-status-exclude"]').trigger("click");
    expect(onInclude).toHaveBeenCalledWith("http.method", "POST");
    expect(onExclude).toHaveBeenCalledWith("status", 502);
  });

  it("copies a leaf as its plain value and emits copy", async () => {
    const w = mount(OJsonViewer, { props: { value: record } });
    await w.find('[data-test="o2-json-viewer-row-service-copy"]').trigger("click");
    await flushPromises();
    expect(copyMock.mock.calls[0][0]).toBe("payments-api");
    expect(w.emitted("copy")?.[0]).toEqual(["service", "payments-api"]);
  });
});
