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
function setup() {
  const open = ref(true),
    org = ref("acme"),
    subject = ref("alice"),
    query = ref(""),
    type = ref<ResourceKind | "all">("all");
  let search!: ReturnType<typeof useResourceSearch>;
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          search = useResourceSearch({ open, org, subject, query, type });
          return () => h("div");
        },
      }),
    ),
  );
  return {
    open,
    org,
    subject,
    query,
    type,
    get search() {
      return search;
    },
  };
}
describe("Command K search lifecycle", () => {
  it("polls only loading sources after a partially successful cold query", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce({
        hits: [],
        sources: [
          { type: "function", status: "complete", has_more: false },
          { type: "dashboard", status: "unavailable", has_more: null, reason: "loading" },
        ],
        took_ms: 0,
      })
      .mockResolvedValue({
        hits: [],
        sources: [{ type: "dashboard", status: "complete", has_more: false }],
        took_ms: 0,
      });
    const s = setup();
    s.query.value = "pay";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls[1][1].types).toEqual(["dashboard"]);
    expect(s.search.data.value?.sources.every((source) => source.status === "complete")).toBe(true);
  });
  it("keeps successful groups and surfaces a failed source retry without rejection", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce({
        hits: [{ type: "function", id: "f", name: "pay", route_ref: { function_name: "f" } }],
        sources: [
          { type: "function", status: "complete", has_more: false },
          {
            type: "dashboard",
            status: "unavailable",
            has_more: null,
            reason: "source_unavailable",
          },
        ],
        took_ms: 0,
      })
      .mockRejectedValue(new Error("offline"));
    const s = setup();
    s.query.value = "pay";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    await expect(s.search.retryFailed()).resolves.toBeUndefined();
    expect(s.search.data.value?.hits[0]?.id).toBe("f");
    expect(s.search.error.value).toBeInstanceOf(Error);
  });

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
  it("cancels a request on identity switch and never shows the old account result", async () => {
    vi.useFakeTimers();
    let resolve!: (r: ResourceSearchResponse) => void;
    vi.mocked(resources.search)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(empty);
    const s = setup();
    s.query.value = "pay";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    const signal = vi.mocked(resources.search).mock.calls[0][2];
    s.subject.value = "bob";
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolve({
      hits: [
        { type: "function", id: "secret", name: "secret", route_ref: { function_name: "secret" } },
      ],
      sources: [],
      took_ms: 0,
    });
    await flushPromises();
    expect(s.search.data.value?.hits ?? []).toEqual([]);
  });
  it("retries only incomplete sources while preserving successful groups", async () => {
    vi.useFakeTimers();
    vi.mocked(resources.search)
      .mockResolvedValueOnce({
        hits: [{ type: "function", id: "f", name: "pay", route_ref: { function_name: "f" } }],
        sources: [
          { type: "function", status: "complete", has_more: false },
          {
            type: "dashboard",
            status: "unavailable",
            has_more: null,
            reason: "source_unavailable",
          },
        ],
        took_ms: 1,
      })
      .mockResolvedValue(empty);
    const s = setup();
    s.query.value = "pay";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    await s.search.retryFailed();
    expect(vi.mocked(resources.search).mock.calls[1][1].types).toEqual(["dashboard"]);
    expect(s.search.data.value?.hits[0]?.id).toBe("f");
  });
});
