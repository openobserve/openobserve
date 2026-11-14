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
import { ref } from "vue";

import type { FindMoreSource } from "./findMore";
import { matchesKey, notNowKey, resetBrowserMatches, useBrowserMatches } from "./useBrowserMatches";

const source = (id: string, packId?: string): FindMoreSource => ({
  id,
  packId,
  label: id,
  streams: [`${id}_logs`],
  items: [{ kind: "alert", id: `${id}/a`, name: "A", queries: 1 }],
  queriesPerDay: 1,
});

const HOSTS = source("hosts", "hosts");
const NGINX = source("library-nginx");
const DOCKER = source("library-docker");

const result = (sources: FindMoreSource[]) => ({ checkedAt: 1, sources, dismissed: 0 });

describe("useBrowserMatches", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBrowserMatches();
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps each org's copy under its own key", () => {
    useBrowserMatches("a").saveFull(result([NGINX]), ["hosts"]);
    useBrowserMatches("b").saveFull(result([DOCKER]), []);
    expect(JSON.parse(window.localStorage.getItem(matchesKey("a"))!).sources).toEqual([NGINX]);
    expect(JSON.parse(window.localStorage.getItem(matchesKey("b"))!).sources).toEqual([DOCKER]);
    resetBrowserMatches();
    expect(useBrowserMatches("a").copy.value?.sources).toEqual([NGINX]);
  });

  it("follows the org it is given", () => {
    const org = ref("a");
    useBrowserMatches("a").saveFull(result([NGINX]), ["hosts"]);
    const matches = useBrowserMatches(org);
    expect(matches.count.value).toBe(1);
    org.value = "b";
    expect(matches.count.value).toBe(0);
  });

  it("shares one copy across callers, so a save updates every reader", () => {
    const header = useBrowserMatches("org");
    useBrowserMatches("org").saveFull(result([NGINX]), ["hosts"]);
    expect(header.count.value).toBe(1);
  });

  it("works in memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const matches = useBrowserMatches("org");
    expect(matches.copy.value).toBeNull();
    matches.saveFull(result([NGINX]), ["hosts"]);
    matches.notNowOne("library-nginx");
    expect(matches.notNow.value).toEqual(["library-nginx"]);
    expect(matches.count.value).toBe(0);
  });

  it("reads invalid JSON as nothing saved", () => {
    window.localStorage.setItem(matchesKey("org"), "{not json");
    window.localStorage.setItem(notNowKey("org"), "[1, 2");
    const matches = useBrowserMatches("org");
    expect(matches.copy.value).toBeNull();
    expect(matches.notNow.value).toEqual([]);
  });

  it("reads a copy of the wrong shape as nothing saved", () => {
    window.localStorage.setItem(matchesKey("org"), JSON.stringify({ sources: "x" }));
    window.localStorage.setItem(notNowKey("org"), JSON.stringify(["a", 3]));
    const matches = useBrowserMatches("org");
    expect(matches.copy.value).toBeNull();
    expect(matches.notNow.value).toEqual(["a"]);
  });

  it("replaces built-in pack sources on a Home save and keeps Library sources", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([source("kubernetes", "kubernetes"), NGINX]), ["hosts"]);
    matches.saveBuiltIn([HOSTS], ["kubernetes"], { packId: "kubernetes", label: "Kubernetes" });
    expect(matches.copy.value?.sources.map(({ id }) => id)).toEqual(["hosts", "library-nginx"]);
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes"]);
    expect(matches.copy.value?.interrupted?.packId).toBe("kubernetes");
  });

  it("keeps the last full check time on a Home save, and sets it only for a first copy", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const matches = useBrowserMatches("org");
    matches.saveBuiltIn([HOSTS], [], null);
    expect(matches.copy.value?.checkedAt).toBe(1000);
    now.mockReturnValue(2000);
    matches.saveFull(result([NGINX]), ["hosts"]);
    expect(matches.copy.value?.checkedAt).toBe(2000);
    now.mockReturnValue(3000);
    matches.saveBuiltIn([HOSTS], ["kubernetes"], null);
    expect(matches.copy.value?.checkedAt).toBe(2000);
    expect(JSON.parse(window.localStorage.getItem(matchesKey("org"))!).checkedAt).toBe(2000);
  });

  it("drops saved sources without a streams list", () => {
    window.localStorage.setItem(
      matchesKey("org"),
      JSON.stringify({
        checkedAt: 1,
        sources: [NGINX, { ...DOCKER, streams: undefined }, { ...HOSTS, streams: "x" }],
        installedPackIds: ["hosts"],
        interrupted: null,
      }),
    );
    expect(useBrowserMatches("org").copy.value?.sources).toEqual([NGINX]);
  });

  it("drops an installed source and records a built-in pack as installed", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), ["kubernetes"]);
    matches.markInstalled("hosts", "hosts");
    expect(matches.copy.value?.sources).toEqual([NGINX]);
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes", "hosts"]);
    matches.markInstalled("library-nginx");
    expect(matches.copy.value?.sources).toEqual([]);
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes", "hosts"]);
  });

  it("hides a match on Not now and brings it back on undo", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([NGINX, DOCKER]), ["hosts"]);
    matches.notNowOne("library-nginx");
    expect(matches.visible.value).toEqual([DOCKER]);
    const hidden = matches.notNowAll();
    expect(hidden).toEqual(["library-docker"]);
    expect(matches.count.value).toBe(0);
    matches.undoNotNow(hidden);
    expect(matches.visible.value).toEqual([DOCKER]);
    expect(JSON.parse(window.localStorage.getItem(notNowKey("org"))!)).toEqual(["library-nginx"]);
  });

  it("shows only with a pack installed and at least one match left", () => {
    const matches = useBrowserMatches("org");
    expect(matches.show.value).toBe(false);
    matches.saveFull(result([NGINX]), []);
    expect(matches.show.value).toBe(false);
    matches.saveFull(result([NGINX]), ["hosts"]);
    expect(matches.show.value).toBe(true);
    matches.notNowAll();
    expect(matches.show.value).toBe(false);
  });

  it("leaves out built-in packs that are already installed", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), ["hosts"]);
    expect(matches.visible.value).toEqual([NGINX]);
    expect(matches.count.value).toBe(1);
    matches.saveFull(result([HOSTS]), ["hosts"]);
    expect(matches.count.value).toBe(0);
    expect(matches.show.value).toBe(false);
  });

  it("shows again for a new match the user has not said Not now to", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([NGINX]), ["hosts"]);
    matches.notNowAll();
    matches.saveFull(result([NGINX, DOCKER]), ["hosts"]);
    expect(matches.visible.value).toEqual([DOCKER]);
    expect(matches.show.value).toBe(true);
  });
});
