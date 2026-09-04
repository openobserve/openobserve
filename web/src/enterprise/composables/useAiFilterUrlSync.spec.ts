// @vitest-environment jsdom
// Tests for useAiFilterUrlSync — the type/stream/agent URL-sync logic
// extracted byte-identical from SessionsList.vue (syncFilterUrl + url reads).
// Covers:
//   • urlType/urlStream/urlAgentName parse from route.query on setup
//   • syncFilterUrl in agent mode: writes type:"agent" + agent:<name>, deletes stream
//   • syncFilterUrl in stream mode: writes type:"stream" + stream:<name>, deletes agent
//   • syncFilterUrl deletes agent/stream when the respective value is empty
//   • router.replace called with the built query

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, computed } from "vue";

const routeQuery: Record<string, any> = {};
const replaceMock = vi.fn(() => Promise.resolve());

vi.mock("vue-router", () => ({
  useRoute: () => ({
    get query() {
      return routeQuery;
    },
  }),
  useRouter: () => ({ replace: replaceMock }),
}));

import { useAiFilterUrlSync } from "./useAiFilterUrlSync";

describe("useAiFilterUrlSync", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    replaceMock.mockClear();
  });

  it("parses urlType/urlStream/urlAgentName from route.query on setup", () => {
    routeQuery.type = "agent";
    routeQuery.stream = "my-stream";
    routeQuery.agent = "my-agent";

    const { urlType, urlStream, urlAgentName } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref(""),
      selectedAgent: ref(null),
    });

    expect(urlType).toBe("agent");
    expect(urlStream).toBe("my-stream");
    expect(urlAgentName).toBe("my-agent");
  });

  it("defaults url reads to empty string when query values are not strings", () => {
    const { urlType, urlStream, urlAgentName } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref(""),
      selectedAgent: ref(null),
    });

    expect(urlType).toBe("");
    expect(urlStream).toBe("");
    expect(urlAgentName).toBe("");
  });

  it("in agent mode with a named agent: writes type=agent, agent=<name>, deletes stream", () => {
    routeQuery.stream = "old-stream";
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("agent"),
      activeStream: ref("some-stream"),
      selectedAgent: ref({ name: "agent-1" }),
    });

    syncFilterUrl();

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const query = replaceMock.mock.calls[0][0].query;
    expect(query.type).toBe("agent");
    expect(query.agent).toBe("agent-1");
    expect(query.stream).toBeUndefined();
  });

  it("in agent mode with no selected agent: deletes agent key", () => {
    routeQuery.agent = "stale-agent";
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("agent"),
      activeStream: ref(""),
      selectedAgent: ref(null),
    });

    syncFilterUrl();

    const query = replaceMock.mock.calls[0][0].query;
    expect(query.type).toBe("agent");
    expect(query.agent).toBeUndefined();
    expect(query.stream).toBeUndefined();
  });

  it("in stream mode with an active stream: writes type=stream, stream=<name>, deletes agent", () => {
    routeQuery.agent = "old-agent";
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref("stream-1"),
      selectedAgent: ref(null),
    });

    syncFilterUrl();

    const query = replaceMock.mock.calls[0][0].query;
    expect(query.type).toBe("stream");
    expect(query.stream).toBe("stream-1");
    expect(query.agent).toBeUndefined();
  });

  it("in stream mode with no active stream: deletes stream key", () => {
    routeQuery.stream = "stale-stream";
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref(""),
      selectedAgent: ref(null),
    });

    syncFilterUrl();

    const query = replaceMock.mock.calls[0][0].query;
    expect(query.type).toBe("stream");
    expect(query.stream).toBeUndefined();
    expect(query.agent).toBeUndefined();
  });

  it("accepts selectedAgent as a ComputedRef", () => {
    const agentRef = ref<{ name?: string } | null>({ name: "computed-agent" });
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("agent"),
      activeStream: ref(""),
      selectedAgent: computed(() => agentRef.value),
    });

    syncFilterUrl();

    const query = replaceMock.mock.calls[0][0].query;
    expect(query.agent).toBe("computed-agent");
  });

  it("preserves other existing query params via spread", () => {
    routeQuery.foo = "bar";
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref("s1"),
      selectedAgent: ref(null),
    });

    syncFilterUrl();

    const query = replaceMock.mock.calls[0][0].query;
    expect(query.foo).toBe("bar");
  });

  it("catches router.replace rejection without throwing", async () => {
    replaceMock.mockReturnValueOnce(Promise.reject(new Error("nav aborted")));
    const { syncFilterUrl } = useAiFilterUrlSync({
      filterMode: ref("stream"),
      activeStream: ref("s1"),
      selectedAgent: ref(null),
    });

    expect(() => syncFilterUrl()).not.toThrow();
  });
});
