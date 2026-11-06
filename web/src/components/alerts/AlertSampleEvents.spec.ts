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

const mountSamples = (streamName = "checkout") =>
  mount(AlertSampleEvents, {
    props: { streamName, streamType: "logs" },
    global: {
      plugins: [
        i18n,
        createStore({
          state: {
            timezone: "UTC",
            zoConfig: {},
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
