import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { describe, it, expect, vi, afterEach } from "vitest";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { usePageVisitHistory } from "./usePageVisitHistory";
import { captureRecentVisitScope, recordPageVisit } from "./useRecentlyViewed";
vi.mock("./useRecentlyViewed", () => ({
  captureRecentVisitScope: vi.fn(() => ({ key: "alice-acme", epoch: 1, org: "acme" })),
  recordPageVisit: vi.fn(),
}));
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllMocks();
});
async function setup(query: Record<string, string> = {}) {
  const component = defineComponent({ setup: () => () => h("div") });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/functions", name: "functionList", component }],
  });
  await router.push({ name: "functionList", query });
  await router.isReady();
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          usePageVisitHistory();
          return () => h("div");
        },
      }),
      { global: { plugins: [router, i18n] } },
    ),
  );
}
describe("Successful page visits", () => {
  it("records an empty successful main list once, under the scope captured before the read", async () => {
    await setup();
    let finish!: (_value: string[]) => void;
    const read = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
    const request = queryClient.fetchQuery({
      queryKey: ["org", "acme", "functions", "list"],
      queryFn: read,
    });
    vi.mocked(captureRecentVisitScope).mockReturnValueOnce({
      key: "bob-acme",
      epoch: 2,
      org: "acme",
    });
    finish([]);
    await request;
    expect(read).toHaveBeenCalledTimes(1);
    expect(recordPageVisit).toHaveBeenCalledWith(
      { key: "alice-acme", epoch: 1, org: "acme" },
      "functionList",
      "Functions",
    );
  });
  it("ignores failed lists, subordinate queries, other organizations and creation forms", async () => {
    await setup({ action: "add" });
    await queryClient.fetchQuery({
      queryKey: ["org", "acme", "functions", "list"],
      queryFn: async () => [],
    });
    expect(recordPageVisit).not.toHaveBeenCalled();
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    await setup();
    await queryClient.fetchQuery({
      queryKey: ["org", "other", "functions", "list"],
      queryFn: async () => [],
    });
    await queryClient.fetchQuery({
      queryKey: ["org", "acme", "functions", "enrichmentStatuses"],
      queryFn: async () => [],
    });
    await expect(
      queryClient.fetchQuery({
        queryKey: ["org", "acme", "functions", "list"],
        queryFn: async () => {
          throw new Error("forbidden");
        },
        retry: false,
        staleTime: 0,
      }),
    ).rejects.toThrow();
    expect(recordPageVisit).not.toHaveBeenCalled();
  });
});
