// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import en from "@/locales/languages/en-US.json";
import { candidateSummary, loadPickedSubtest, useSubtestCandidates } from "./useSubtestCandidates";

vi.mock("@/services/synthetics", () => ({
  default: { listByFolderId: vi.fn(), get: vi.fn() },
}));

import syntheticsService from "@/services/synthetics";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const list = syntheticsService.listByFolderId as ReturnType<typeof vi.fn>;
const get = syntheticsService.get as ReturnType<typeof vi.fn>;

const ROWS = [
  { id: "self", name: "Checkout", type: "browser", steps: 4, references: 0 },
  {
    id: "login",
    name: "Login",
    type: "browser",
    folder_id: "shared",
    steps: 13,
    referenced_by: 5,
    references: 0,
    enabled: true,
  },
  {
    id: "paused",
    name: "Login (staging)",
    type: "browser",
    steps: 1,
    referenced_by: 0,
    references: 0,
    enabled: false,
  },
  { id: "holder", name: "Full flow", type: "browser", steps: 20, references: 1 },
  { id: "api", name: "Orders API", type: "http" },
];

type Candidates = ReturnType<typeof useSubtestCandidates>;

function mountHost(
  enabled: Ref<boolean> | boolean = true,
  onError?: (err: unknown) => void,
  ownId = "self",
) {
  let api!: Candidates;
  const Host = defineComponent({
    setup() {
      api = useSubtestCandidates(() => ownId, { enabled, onError });
      return () => null;
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store, i18n] } });
  return { wrapper, api: () => api };
}

describe("useSubtestCandidates", () => {
  beforeEach(() => {
    store.commit("setFoldersByType", { synthetics: [{ folderId: "shared", name: "Shared" }] });
  });

  afterEach(() => {
    list.mockReset();
    get.mockReset();
  });

  it("fetches nothing until enabled, then reads the org's whole list", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const enabled = ref(false);
    const { api } = mountHost(enabled);
    await flushPromises();
    expect(list).not.toHaveBeenCalled();
    expect(api().isLoading.value).toBe(false);
    expect(api().isEmpty.value).toBe(false);

    enabled.value = true;
    await flushPromises();
    expect(list).toHaveBeenCalledWith("default", undefined);
    expect(api().isLoading.value).toBe(false);
    expect(api().usable.value).toHaveLength(2);
  });

  it("is loading from the moment it is enabled until the list lands", async () => {
    list.mockReturnValue(new Promise(() => {}));
    const { api } = mountHost();
    expect(api().isLoading.value).toBe(true);
    await flushPromises();
    expect(api().isLoading.value).toBe(true);
  });

  it("excludes its own check and non-browser checks, and splits usable from nested-holding", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const { api } = mountHost();
    await flushPromises();

    expect(api().usable.value.map((c) => c.id)).toEqual(["login", "paused"]);
    expect(api().blocked.value.map((c) => c.id)).toEqual(["holder"]);
    expect(api().isEmpty.value).toBe(false);
  });

  it("resolves each row's labels from the list response alone", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const { api } = mountHost();
    await flushPromises();

    const [login, paused] = api().usable.value;
    expect(login).toMatchObject({
      name: "Login",
      folderName: "Shared",
      stepsLabel: "13 steps",
      usedByLabel: "Used by 5 tests",
      pausedLabel: "",
    });
    expect(paused.usedByLabel).toBe("");
    expect(paused.pausedLabel).toBe("Paused");
    expect(candidateSummary([paused.stepsLabel, paused.usedByLabel, paused.pausedLabel])).toBe(
      "1 step · Paused",
    );
  });

  it("is empty only once a load finds no other browser test", async () => {
    list.mockResolvedValue({ data: { checks: [ROWS[0], ROWS[4]] } });
    const { api } = mountHost();
    expect(api().isEmpty.value).toBe(false);

    await flushPromises();

    expect(api().isEmpty.value).toBe(true);
    expect(api().usable.value).toEqual([]);
    expect(api().blocked.value).toEqual([]);
  });

  it("flags a failed load, reports it, and clears the flag when refetch succeeds", async () => {
    const onError = vi.fn();
    list.mockRejectedValueOnce(new Error("boom"));
    const { api } = mountHost(true, onError);
    await flushPromises();

    expect(api().loadError.value).toBe(true);
    expect(api().isLoading.value).toBe(false);
    expect(api().isEmpty.value).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    list.mockResolvedValue({ data: { checks: ROWS } });
    await api().refetch();
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    expect(api().loadError.value).toBe(false);
    expect(api().usable.value).toHaveLength(2);
  });

  it("serves a second mount from the cache without a request", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const first = mountHost();
    await flushPromises();
    first.wrapper.unmount();

    const second = mountHost();
    expect(second.api().isLoading.value).toBe(false);
    expect(second.api().usable.value.map((c) => c.id)).toEqual(["login", "paused"]);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("loadPickedSubtest", () => {
  afterEach(() => get.mockReset());

  it("returns the reference and the child's step count", async () => {
    get.mockResolvedValue({ data: { name: "Login", config: { steps: [{}, {}, {}] } } });

    await expect(loadPickedSubtest("default", "login", "Stale")).resolves.toEqual({
      reference: { id: "login", name: "Login" },
      stepCount: 3,
    });
    expect(get).toHaveBeenCalledWith("default", "login");
  });

  it("falls back to the given name, and throws when the GET fails", async () => {
    get.mockResolvedValueOnce({ data: {} });
    await expect(loadPickedSubtest("default", "login", "Login")).resolves.toEqual({
      reference: { id: "login", name: "Login" },
      stepCount: 0,
    });

    get.mockRejectedValueOnce(new Error("gone"));
    await expect(loadPickedSubtest("default", "login")).rejects.toThrow("gone");
  });
});
