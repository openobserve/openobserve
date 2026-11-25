// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import AlertStreamContents from "./AlertStreamContents.vue";

type Handlers = { data: (p: unknown, r: unknown) => void; error: () => void; complete: () => void };
const stream = vi.fn();
const getStream = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => stream(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream }) }));

const event = { _timestamp: 1_700_000_000_000_000, message: "payment failed" };
// Answers the label-count search with one row and the samples search with the given hits.
const answer = (samples: unknown[] | null) =>
  stream.mockImplementation((req: { queryReq: { query: { size: number } } }, h: Handlers) => {
    const counting = req.queryReq.query.size === 1;
    if (samples === null && !counting) return h.error();
    const hits = counting ? [{ host: 3, mode: 2 }] : samples;
    h.data({}, { type: "search_response_hits", content: { results: { hits } } });
    h.complete();
  });

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  stream.mockReset();
});

const mountLine = (streamType: string) =>
  (wrapper = mount(AlertStreamContents, {
    props: { streamName: "checkout", streamType },
    global: {
      plugins: [
        i18n,
        createStore({
          state: { timezone: "UTC", zoConfig: {}, selectedOrganization: { identifier: "default" } },
        }),
      ],
    },
  }));

describe("AlertStreamContents", () => {
  it.each([
    ["metrics", [event, event], "What's in this stream: 2 labels · 2 recent samples", false],
    ["logs", [event], "What's in this stream: 1 recent event", false],
    ["logs", [], "What's in this stream: nothing in the last hour", false],
    ["logs", null, "What's in this stream: recent events couldn't load", true],
  ])("counts a %s stream's contents on the closed line", async (type, samples, line, failed) => {
    getStream.mockResolvedValue({
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "value", type: "Float64" },
        { name: "host", type: "Utf8" },
        { name: "mode", type: "Utf8" },
      ],
    });
    answer(samples);
    const w = mountLine(type);
    await flushPromises();
    const toggle = w.find('[data-test="add-alert-stream-contents-toggle"]');
    expect(toggle.text().replace(/\s+/g, " ")).toBe(`${line}Show`);
    expect(w.find(".text-status-error-text").exists()).toBe(failed);
    expect(w.find('[data-test="add-alert-sample-events"]').exists()).toBe(false);
  });

  it("opens to the labels and events it already loaded, without searching again", async () => {
    getStream.mockResolvedValue({
      schema: [
        { name: "value", type: "Float64" },
        { name: "host", type: "Utf8" },
      ],
    });
    answer([event]);
    const w = mountLine("metrics");
    await flushPromises();
    const searches = stream.mock.calls.length;
    await w.find('[data-test="add-alert-stream-contents-toggle"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="add-alert-metric-label-host"]').exists()).toBe(true);
    expect(w.findAll('[data-test="add-alert-sample-event"]')).toHaveLength(1);
    expect(stream.mock.calls.length).toBe(searches);
  });
});
