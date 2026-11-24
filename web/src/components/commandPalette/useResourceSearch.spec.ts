import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useResourceSearch } from "./useResourceSearch";
import resources from "@/services/resources";
import type { ResourceSearchResponse, ResourceKind } from "@/ts/interfaces/resources";
vi.mock("@/services/resources", () => ({ default: { search: vi.fn() } }));
const empty: ResourceSearchResponse = { hits: [], sources: [], took_ms: 0 };
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});
function setup(initialType: ResourceKind | "all" = "all", initialOffset = 0) {
  const open = ref(true),
    org = ref("acme"),
    subject = ref("alice"),
    query = ref(""),
    type = ref<ResourceKind | "all">(initialType),
    offset = ref(initialOffset);
  let search!: ReturnType<typeof useResourceSearch>;
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          search = useResourceSearch({ open, org, subject, query, type, offset });
          return () => h("div");
        },
      }),
    ),
  );
  return {
    subject,
    query,
    get search() {
      return search;
    },
  };
}
async function typeQuery(s: ReturnType<typeof setup>, q: string) {
  s.query.value = q;
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  await flushPromises();
}
const partial: ResourceSearchResponse = {
  hits: [{ type: "function", id: "f", name: "pay", route_ref: { function_name: "f" } }],
  sources: [
    { type: "function", status: "complete", has_more: false },
    { type: "dashboard", status: "unavailable", has_more: null, reason: "source_unavailable" },
  ],
  took_ms: 0,
};
describe("Command K search lifecycle", () => {
  it("makes no resource request for empty All and debounces typing", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search).mockResolvedValue(empty);
    const s = setup();
    await flushPromises();
    expect(resources.search).not.toHaveBeenCalled();
    s.query.value = "pay";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(199);
    expect(resources.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(resources.search).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resources.search).mock.calls[0][1].q).toBe("pay");
  });
  it("polls only loading sources in the background, outside the pending state", async () => {
    vi.useFakeTimers();
    let finishPoll!: (value: ResourceSearchResponse) => void;
    vi.mocked(resources.search)
      .mockResolvedValueOnce({
        hits: [],
        sources: [
          { type: "function", status: "complete", has_more: false },
          { type: "dashboard", status: "unavailable", has_more: null, reason: "loading" },
        ],
        took_ms: 0,
      })
      .mockReturnValueOnce(new Promise((resolve) => (finishPoll = resolve)) as never);
    const s = setup();
    await typeQuery(s, "pay");
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(resources.search).mock.calls[1][1].types).toEqual(["dashboard"]);
    expect(s.search.pending.value).toBe(false);
    finishPoll({
      hits: [],
      sources: [{ type: "dashboard", status: "complete", has_more: false }],
      took_ms: 0,
    });
    await flushPromises();
    expect(s.search.data.value?.sources.every((source) => source.status === "complete")).toBe(true);
  });
  it("polls a loading page with its offset so the pager and hits stay in step", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce({
        hits: [],
        sources: [{ type: "function", status: "unavailable", has_more: null, reason: "loading" }],
        took_ms: 0,
      })
      .mockResolvedValue(empty);
    const s = setup("function", 40);
    await typeQuery(s, "pay");
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(resources.search).mock.calls[1][1]).toMatchObject({
      types: ["function"],
      offset: 40,
    });
  });
  it("manual retry asks only failed sources and keeps successful groups", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce(partial)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(empty);
    const s = setup();
    await typeQuery(s, "pay");
    await expect(s.search.retryFailed()).resolves.toBeUndefined();
    expect(s.search.error.value).toBeInstanceOf(Error);
    await s.search.retryFailed();
    expect(vi.mocked(resources.search).mock.calls[2][1].types).toEqual(["dashboard"]);
    expect(s.search.data.value?.hits[0]?.id).toBe("f");
  });
  it("drops earlier retry results when the whole search is fetched again", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce({
        hits: [],
        sources: [{ type: "dashboard", status: "complete", has_more: false }],
        took_ms: 0,
      })
      .mockResolvedValue({
        hits: [
          {
            type: "dashboard",
            id: "d",
            name: "pay",
            route_ref: { dashboard_id: "d", folder_id: "default" },
          },
        ],
        sources: [
          { type: "function", status: "complete", has_more: false },
          { type: "dashboard", status: "complete", has_more: false },
        ],
        took_ms: 0,
      });
    const s = setup();
    await typeQuery(s, "pay");
    await s.search.retryFailed();
    await s.search.refetch();
    await flushPromises();
    expect(s.search.data.value?.hits.map((hit) => hit.id)).toEqual(["d"]);
  });
  it("cancels a request on identity switch and never shows the old account result", async () => {
    vi.useFakeTimers();
    let resolve!: (r: ResourceSearchResponse) => void;
    vi.mocked(resources.search)
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValue(empty);
    const s = setup();
    await typeQuery(s, "pay");
    const signal = vi.mocked(resources.search).mock.calls[0][2];
    s.subject.value = "bob";
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolve(partial);
    await flushPromises();
    expect(s.search.data.value?.hits ?? []).toEqual([]);
  });
});
