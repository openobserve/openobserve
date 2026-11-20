import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import store from "@/stores";
import { resetListViewState, useListViewState } from "./useListViewState";

describe("useListViewState", () => {
  beforeEach(() => {
    resetListViewState();
    store.state.selectedOrganization = { identifier: "org1" } as any;
  });

  it("returns the defaults the first time", () => {
    const state = useListViewState("alerts", { searchQuery: "", pageSize: 20 });
    expect(state).toEqual({ searchQuery: "", pageSize: 20 });
  });

  it("hands back the same state after the component is gone", () => {
    useListViewState("alerts", { searchQuery: "" }).searchQuery = "cpu";
    expect(useListViewState("alerts", { searchQuery: "" }).searchQuery).toBe("cpu");
  });

  it("shares one object between callers of the same list", () => {
    const first = useListViewState("alerts", { searchQuery: "" });
    const second = useListViewState("alerts", { searchQuery: "", sortBy: "" });
    expect(second).toBe(first);
    expect(first.sortBy).toBe("");
  });

  it("fills in fields added after the state was first stored", () => {
    useListViewState("alerts", { searchQuery: "cpu" });
    expect(useListViewState("alerts", { searchQuery: "", sortBy: "" })).toEqual({
      searchQuery: "cpu",
      sortBy: "",
    });
  });

  it("keeps lists and organizations apart", () => {
    useListViewState("alerts", { searchQuery: "" }).searchQuery = "cpu";
    expect(useListViewState("reports", { searchQuery: "" }).searchQuery).toBe("");
    store.state.selectedOrganization = { identifier: "org2" } as any;
    expect(useListViewState("alerts", { searchQuery: "" }).searchQuery).toBe("");
  });

  it("resets one list or all of them", () => {
    useListViewState("alerts", { q: "" }).q = "a";
    useListViewState("reports", { q: "" }).q = "b";
    resetListViewState("alerts");
    expect(useListViewState("alerts", { q: "" }).q).toBe("");
    expect(useListViewState("reports", { q: "" }).q).toBe("b");
    resetListViewState();
    expect(useListViewState("reports", { q: "" }).q).toBe("");
  });
});

describe("useListViewState with URL params", () => {
  const defaults = { q: "", page: 1, all: false, states: [] as string[] };
  const params = { q: "q", page: "page", all: "all", states: "state" };
  let router: Router;
  let wrapper: VueWrapper | undefined;
  let state: typeof defaults;

  const Page = defineComponent({ render: () => h("div") });
  const List = defineComponent({
    setup() {
      state = useListViewState("streams", { ...defaults, states: [] }, { url: params });
      return () => h("div");
    },
  });

  const mountAt = async (url: string) => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/streams", name: "streams", component: Page },
        { path: "/other", name: "other", component: Page },
      ],
    });
    await router.push(url);
    wrapper = mount(List, { global: { plugins: [router] } });
    await settle();
  };

  const settle = async () => {
    await flushPromises();
    vi.advanceTimersByTime(200);
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    resetListViewState();
    store.state.selectedOrganization = { identifier: "org1" } as any;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("restores every listed field from a pasted link, typed like its default", async () => {
    await mountAt("/streams?v.q=app&v.page=3&v.all=true&v.state=failed&v.state=paused");
    expect(state).toEqual({ q: "app", page: 3, all: true, states: ["failed", "paused"] });
  });

  it("writes changes into the URL, leaving defaults and the page's own query alone", async () => {
    await mountAt("/streams?org_identifier=default");
    state.q = "nginx";
    state.page = 2;
    state.states = ["failed"];
    await settle();
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "default",
      "v.q": "nginx",
      "v.page": "2",
      "v.state": ["failed"],
    });

    state.q = "";
    state.page = 1;
    await settle();
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "default",
      "v.state": ["failed"],
    });
  });

  it("replaces the history entry, so Back still leaves the list", async () => {
    await mountAt("/other");
    await router.push("/streams");
    wrapper?.unmount();
    wrapper = mount(List, { global: { plugins: [router] } });
    state.q = "x";
    await settle();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/other");
  });

  it("puts the remembered state back into a URL that arrives without it", async () => {
    await mountAt("/streams");
    state.q = "app";
    await settle();
    await router.push("/streams?org_identifier=default");
    await settle();
    expect(router.currentRoute.value.query["v.q"]).toBe("app");
  });

  it("follows Back and Forward exactly, a missing param meaning the default", async () => {
    await mountAt("/streams?folder=a");
    await router.push("/streams?folder=b&v.q=app&v.state=failed");
    await settle();
    expect(state.q).toBe("app");

    router.back();
    await settle();
    expect(state).toMatchObject({ q: "", states: [] });
    expect(router.currentRoute.value.query).toEqual({ folder: "a" });

    router.forward();
    await settle();
    expect(state).toMatchObject({ q: "app", states: ["failed"] });
  });

  it("ignores a param it cannot read and keeps the remembered value", async () => {
    await mountAt("/streams?v.page=abc");
    expect(state.page).toBe(1);
  });

  it("stops writing once the user has left the list", async () => {
    await mountAt("/streams");
    await router.push("/other");
    state.q = "late";
    await settle();
    expect(router.currentRoute.value.fullPath).toBe("/other");
  });
});
