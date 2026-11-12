// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { b64DecodeUnicode } from "@/utils/zincutils";
import AlertSampleEvents from "./AlertSampleEvents.vue";

type Handlers = { data: (p: unknown, r: unknown) => void; error: () => void; complete: () => void };
const stream = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => stream(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const answer = (hits: unknown[] | null) =>
  stream.mockImplementation((_req: unknown, handlers: Handlers) => {
    if (hits === null) return handlers.error();
    handlers.data({}, { type: "search_response_hits", content: { results: { hits } } });
    handlers.complete();
  });

const mountSamples = (streamName = "checkout", zoConfig: Record<string, unknown> = {}) =>
  mount(AlertSampleEvents, {
    props: { streamName, streamType: "logs" },
    global: {
      plugins: [
        i18n,
        createStore({
          state: {
            timezone: "UTC",
            zoConfig,
            selectedOrganization: { identifier: "default" },
          },
        }),
      ],
    },
  });

describe("AlertSampleEvents", () => {
  beforeEach(() => {
    stream.mockReset();
  });

  it("lists recent events, preferring a message field over the whole row", async () => {
    answer([
      { _timestamp: 1_700_000_000_000_000, message: "payment failed", level: "error" },
      { _timestamp: 1_700_000_000_000_000, level: "info" },
    ]);
    const wrapper = mountSamples();
    await flushPromises();
    const rows = wrapper.findAll('[data-test="add-alert-sample-event"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("payment failed");
    expect(rows[0].text()).not.toContain("level");
    expect(rows[1].text()).toContain('{"level":"info"}');
  });

  it("asks the streaming search for the stream, with its name escaped", async () => {
    answer([]);
    mountSamples('odd"name');
    await flushPromises();
    const request = stream.mock.calls[0][0] as {
      type: string;
      queryReq: { query: { sql: string }; encoding: string };
    };
    expect(request.type).toBe("search");
    expect(request.queryReq.encoding).toBe("base64");
    expect(b64DecodeUnicode(request.queryReq.query.sql)).toContain('FROM "odd""name"');
  });

  it("orders by and reads the deployment's own timestamp column", async () => {
    answer([{ ts: 1_700_000_000_000_000, message: "payment failed" }]);
    const wrapper = mountSamples("checkout", { timestamp_column: "ts" });
    await flushPromises();
    const request = stream.mock.calls[0][0] as { queryReq: { query: { sql: string } } };
    expect(b64DecodeUnicode(request.queryReq.query.sql)).toContain('ORDER BY "ts" DESC');
    const row = wrapper.get('[data-test="add-alert-sample-event"]').text();
    expect(row).toContain("payment failed");
    expect(row).not.toContain("Invalid");
  });

  it("keeps only the latest chunk of a streaming aggregation instead of stacking chunks", async () => {
    stream.mockImplementation((_req: unknown, handlers: Handlers) => {
      const partition = (message: string) => {
        handlers.data({}, { type: "search_response_metadata", content: { streaming_aggs: true } });
        handlers.data(
          {},
          {
            type: "search_response_hits",
            content: { results: { hits: [{ _timestamp: 1, message }] } },
          },
        );
      };
      partition("first pass");
      partition("final pass");
      handlers.complete();
    });
    const wrapper = mountSamples();
    await flushPromises();
    const rows = wrapper.findAll('[data-test="add-alert-sample-event"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("final pass");
  });

  it("appends hits batches when the search is not a streaming aggregation", async () => {
    stream.mockImplementation((_req: unknown, handlers: Handlers) => {
      handlers.data({}, { type: "search_response_metadata", content: { streaming_aggs: false } });
      for (const message of ["one", "two"]) {
        handlers.data(
          {},
          {
            type: "search_response_hits",
            content: { results: { hits: [{ _timestamp: 1, message }] } },
          },
        );
      }
      handlers.complete();
    });
    const wrapper = mountSamples();
    await flushPromises();
    expect(wrapper.findAll('[data-test="add-alert-sample-event"]')).toHaveLength(2);
  });

  it("says so when the stream has nothing recent", async () => {
    answer([]);
    const wrapper = mountSamples();
    await flushPromises();
    expect(wrapper.get('[data-test="add-alert-sample-status"]').text()).toBe(
      "Nothing in the last hour. You can still alert on this stream.",
    );
  });

  it("says so when the events cannot be loaded", async () => {
    answer(null);
    const wrapper = mountSamples();
    await flushPromises();
    expect(wrapper.get('[data-test="add-alert-sample-status"]').text()).toBe(
      "Could not load recent events.",
    );
  });
});
