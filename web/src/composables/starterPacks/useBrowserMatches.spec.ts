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
import { matchesKey, resetBrowserMatches, useBrowserMatches } from "./useBrowserMatches";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

loadCatalogFixture();

const source = (id: string, packId?: string): FindMoreSource => ({
  id,
  packId,
  label: id,
  streams: [`${id}_logs`],
  items: [{ kind: "alert", id: `${id}/a`, name: "A" }],
});

const HOSTS = source("hosts", "hosts");
const NGINX = source("postgresql", "postgresql");
const DOCKER = source("docker", "docker");
const LIBRARY = source("library-k8s");

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
    expect(matches.count.value).toBe(1);
  });

  it("reads invalid JSON as nothing saved", () => {
    window.localStorage.setItem(matchesKey("org"), "{not json");
    expect(useBrowserMatches("org").copy.value).toBeNull();
  });

  it("reads a copy of the wrong shape as nothing saved", () => {
    window.localStorage.setItem(matchesKey("org"), JSON.stringify({ sources: "x" }));
    expect(useBrowserMatches("org").copy.value).toBeNull();
  });

  it("replaces every source on a Home save, keeping only a set-up pack's last source", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([source("kubernetes", "kubernetes"), NGINX]), ["hosts"]);
    matches.saveBuiltIn([HOSTS], ["kubernetes"], { packId: "kubernetes", label: "Kubernetes" });
    expect(matches.copy.value?.sources.map(({ id }) => id)).toEqual(["hosts", "kubernetes"]);
    expect(matches.visible.value.map(({ id }) => id)).toEqual(["hosts"]);
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes"]);
    expect(matches.copy.value?.interrupted?.packId).toBe("kubernetes");
  });

  it("stamps Home's check as the latest check time", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const matches = useBrowserMatches("org");
    matches.saveBuiltIn([HOSTS], [], null);
    expect(matches.copy.value?.checkedAt).toBe(1000);
    now.mockReturnValue(2000);
    matches.saveFull(result([NGINX]), ["hosts"]);
    expect(matches.copy.value?.checkedAt).toBe(2000);
    now.mockReturnValue(3000);
    matches.saveBuiltIn([HOSTS], ["kubernetes"], null);
    expect(matches.copy.value?.checkedAt).toBe(3000);
    expect(JSON.parse(window.localStorage.getItem(matchesKey("org"))!).checkedAt).toBe(3000);
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

  it("keeps only built-in packs, so the header lists what Home offers", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, LIBRARY]), []);
    expect(matches.visible.value).toEqual([HOSTS]);
    expect(JSON.parse(window.localStorage.getItem(matchesKey("org"))!).sources).toEqual([HOSTS]);
  });

  it("drops Library groups from a copy saved by an older version", () => {
    window.localStorage.setItem(
      matchesKey("org"),
      JSON.stringify({ checkedAt: 1, sources: [LIBRARY, HOSTS], installedPackIds: [] }),
    );
    expect(useBrowserMatches("org").visible.value).toEqual([HOSTS]);
  });

  it("records a built-in pack as installed and hides its source, keeping it for an undo", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), ["kubernetes"]);
    matches.markInstalled("hosts", "hosts");
    expect(matches.visible.value).toEqual([NGINX]);
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes", "hosts"]);
    matches.markInstalled("library-k8s");
    expect(matches.copy.value?.installedPackIds).toEqual(["kubernetes", "hosts"]);
  });

  it("lists a pack again after its setup is undone, and keeps that across a reload", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), []);
    matches.markInstalled("hosts", "hosts");
    expect(matches.count.value).toBe(1);
    matches.markRemoved("hosts");
    expect(matches.count.value).toBe(2);
    expect(matches.copy.value?.installedPackIds).toEqual([]);
    resetBrowserMatches();
    expect(useBrowserMatches("org").visible.value).toEqual([HOSTS, NGINX]);
  });

  it("lists a pack again after an undo that follows a check run while it was set up", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), []);
    matches.markInstalled("hosts", "hosts");
    matches.saveFull(result([NGINX]), ["hosts"]);
    expect(matches.count.value).toBe(1);
    matches.markRemoved("hosts");
    expect(matches.visible.value).toEqual([NGINX, HOSTS]);
    expect(matches.count.value).toBe(2);
  });

  it("drops a set-up pack's old source once a check finds it no longer set up", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS]), []);
    matches.markInstalled("hosts", "hosts");
    matches.saveFull(result([NGINX]), []);
    expect(matches.copy.value?.sources).toEqual([NGINX]);
  });

  it("clears an interrupted setup of the pack that was undone", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS]), [], { packId: "hosts", label: "Hosts" });
    matches.markRemoved("hosts");
    expect(matches.copy.value?.interrupted).toBeNull();
  });

  it("shows once a check has run, even with every match set up or none found", () => {
    const matches = useBrowserMatches("org");
    expect(matches.show.value).toBe(false);
    matches.saveFull(result([NGINX]), []);
    expect(matches.show.value).toBe(true);
    matches.saveFull(result([HOSTS]), ["hosts"]);
    expect(matches.count.value).toBe(0);
    expect(matches.show.value).toBe(true);
    matches.saveFull(result([]), []);
    expect(matches.show.value).toBe(true);
  });

  it("leaves out built-in packs that are already installed", () => {
    const matches = useBrowserMatches("org");
    matches.saveFull(result([HOSTS, NGINX]), ["hosts"]);
    expect(matches.visible.value).toEqual([NGINX]);
    expect(matches.count.value).toBe(1);
    matches.saveFull(result([HOSTS]), ["hosts"]);
    expect(matches.count.value).toBe(0);
  });

  it("keeps every match listed until it is set up, with no way to hide one (D2)", () => {
    const matches = useBrowserMatches("org");
    window.localStorage.setItem("o2.starterPacks.notNow.org", JSON.stringify(["postgresql"]));
    matches.saveFull(result([NGINX, DOCKER]), []);
    expect(matches.visible.value).toEqual([NGINX, DOCKER]);
    expect("notNowOne" in matches).toBe(false);
  });

  it("forgets an org's copy in memory and in storage, leaving other orgs alone", () => {
    useBrowserMatches("a").saveFull(result([NGINX]), []);
    useBrowserMatches("b").saveFull(result([DOCKER]), []);
    const reader = useBrowserMatches("a");
    useBrowserMatches("a").clear();
    expect(reader.copy.value).toBeNull();
    expect(reader.show.value).toBe(false);
    expect(window.localStorage.getItem(matchesKey("a"))).toBeNull();
    resetBrowserMatches();
    expect(useBrowserMatches("a").copy.value).toBeNull();
    expect(useBrowserMatches("b").copy.value?.sources).toEqual([DOCKER]);
  });
});
