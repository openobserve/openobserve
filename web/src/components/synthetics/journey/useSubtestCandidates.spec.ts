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
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import en from "@/locales/languages/en-US.json";
import { candidateSummary, useSubtestCandidates } from "./useSubtestCandidates";

vi.mock("@/services/synthetics", () => ({
  default: { listByFolderId: vi.fn() },
}));

import syntheticsService from "@/services/synthetics";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const list = syntheticsService.listByFolderId as ReturnType<typeof vi.fn>;

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

function mountHost(options: Parameters<typeof useSubtestCandidates>[1] = {}, ownId = "self") {
  let api!: Candidates;
  const Host = defineComponent({
    setup() {
      api = useSubtestCandidates(() => ownId, options);
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
  });

  it("does not fetch until asked, unless immediate", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const lazy = mountHost();
    await flushPromises();
    expect(list).not.toHaveBeenCalled();
    expect(lazy.api().isLoading.value).toBe(false);
    lazy.wrapper.unmount();

    const eager = mountHost({ immediate: true });
    expect(eager.api().isLoading.value).toBe(true);
    await flushPromises();
    expect(list).toHaveBeenCalledWith("default", undefined);
    expect(eager.api().isLoading.value).toBe(false);
  });

  it("excludes its own check and non-browser checks, and splits usable from nested-holding", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const { api } = mountHost();
    await api().reload();

    expect(api().usable.value.map((c) => c.id)).toEqual(["login", "paused"]);
    expect(api().blocked.value.map((c) => c.id)).toEqual(["holder"]);
    expect(api().isEmpty.value).toBe(false);
  });

  it("resolves each row's labels from the list response alone", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const { api } = mountHost();
    await api().reload();

    const [login, paused] = api().usable.value;
    expect(login).toMatchObject({
      name: "Login",
      folderName: "Shared",
      enabled: true,
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

    await api().reload();

    expect(api().isEmpty.value).toBe(true);
    expect(api().usable.value).toEqual([]);
    expect(api().blocked.value).toEqual([]);
  });

  it("flags a failed load, reports it, and clears the flag on a successful retry", async () => {
    const onError = vi.fn();
    list.mockRejectedValueOnce(new Error("boom"));
    const { api } = mountHost({ onError });

    expect(await api().reload()).toBe(false);
    expect(api().loadError.value).toBe(true);
    expect(api().isLoading.value).toBe(false);
    expect(api().isEmpty.value).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    list.mockResolvedValue({ data: { checks: ROWS } });
    expect(await api().reload()).toBe(true);
    expect(api().loadError.value).toBe(false);
    expect(api().usable.value).toHaveLength(2);
  });

  it("joins a reload that is already in flight instead of fetching twice", async () => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    const { api } = mountHost();

    await Promise.all([api().reload(), api().reload()]);

    expect(list).toHaveBeenCalledTimes(1);
  });
});
