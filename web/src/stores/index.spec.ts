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

import { describe, expect, it } from "vitest";
import store from "./index";

// `store` is an imported singleton mutated by every test in this file, so the
// DECLARED initial state cannot be observed from inside a test that has already
// committed something. Capture it at module evaluation, before any test runs.
//
// Values, not structuredClone: Vuex state is a reactive proxy and does not
// survive cloning ("#<Object> could not be cloned"). Deliberately no `??`
// fallbacks — if the alertLibrary block is missing entirely, these must stay
// undefined so the assertions below fail rather than silently pass.
const declaredLib = store.state.alertLibrary as
  | { manifest: unknown; lastFetched: number | null; cacheExpiry: number; fileCache: object }
  | undefined;
const declaredAlertLibrary = {
  exists: declaredLib !== undefined,
  manifest: declaredLib?.manifest,
  lastFetched: declaredLib?.lastFetched,
  cacheExpiry: declaredLib?.cacheExpiry,
  fileCacheKeyCount: declaredLib?.fileCache ? Object.keys(declaredLib.fileCache).length : undefined,
};

describe("root store", () => {
  describe("setFoldersByType", () => {
    it("keeps other modules' folders when one module commits its own", () => {
      // Every module (dashboards, alerts, reports, synthetics) caches its
      // folders under its own key. Replacing the map instead of merging meant
      // whichever module fetched last wiped the rest — and a fetch that
      // resolved after the user had moved on left the page they were now
      // looking at with no folders at all.
      store.commit("setFoldersByType", {
        dashboards: [{ folderId: "default", name: "default" }],
      });
      store.commit("setFoldersByType", {
        alerts: [{ folderId: "default", name: "default" }],
      });

      expect(store.state.organizationData.foldersByType).toEqual({
        dashboards: [{ folderId: "default", name: "default" }],
        alerts: [{ folderId: "default", name: "default" }],
      });
    });

    it("replaces the folders of the type being committed", () => {
      store.commit("setFoldersByType", {
        reports: [{ folderId: "default", name: "default" }],
      });
      store.commit("setFoldersByType", {
        reports: [{ folderId: "shared", name: "shared" }],
      });

      expect(store.state.organizationData.foldersByType.reports).toEqual([
        { folderId: "shared", name: "shared" },
      ]);
    });
  });

  describe("alert library cache", () => {
    // The alert library is served from S3 as one manifest plus one file per
    // alert fetched on demand. This is the cache behind both, mirroring the
    // dashboardGallery block that sits beside it.

    it("declares an empty cache so a cold session always fetches", () => {
      // Asserted against the pre-test snapshot, NOT after a clearAlertLibrary
      // commit: committing first would test the mutation and leave a poisoned
      // initial state (a stale manifest baked into the store declaration)
      // completely undetected.
      expect(declaredAlertLibrary.exists).toBe(true);
      expect(declaredAlertLibrary.manifest).toBeNull();
      expect(declaredAlertLibrary.lastFetched).toBeNull();
      expect(declaredAlertLibrary.fileCacheKeyCount).toBe(0);
    });

    it("stamps lastFetched when the manifest is cached", () => {
      // The TTL check reads this; leaving it null would make a warm cache look
      // permanently stale and refetch 47 KB on every render.
      store.commit("clearAlertLibrary");
      const before = Date.now();
      store.commit("setAlertLibraryManifest", { format_version: "1.0.0", alerts: [] });

      expect(store.state.alertLibrary.manifest).toEqual({
        format_version: "1.0.0",
        alerts: [],
      });
      expect(store.state.alertLibrary.lastFetched).toBeGreaterThanOrEqual(before);
    });

    it("declares a 10-minute TTL for the manifest cache", () => {
      // Read from the pre-test snapshot so this cannot be rescued by an earlier
      // test's clearAlertLibrary: asserting live state made it pass in a full
      // run and fail when run alone.
      //
      // Pinned to an exact value, not "> 0": useAlertLibrary.spec mocks this
      // store shape, so an unpinned value lets the mock and the real store
      // drift apart while both suites stay green. Matches dashboardGallery's.
      expect(declaredAlertLibrary.cacheExpiry).toBe(10 * 60 * 1000);
    });

    it("leaves the TTL alone when the cache is cleared", () => {
      // cacheExpiry is configuration, not cached data. Uses a SENTINEL rather
      // than asserting the default: a `clear` implemented as
      // `state.alertLibrary = freshState()` would reset the TTL to the correct
      // default and pass, hiding that it clobbers configuration. Only a value
      // that could not come from a fresh object proves it mutates in place.
      store.state.alertLibrary.cacheExpiry = 12_345;
      store.commit("clearAlertLibrary");

      expect(store.state.alertLibrary.cacheExpiry).toBe(12_345);
      store.state.alertLibrary.cacheExpiry = 10 * 60 * 1000;
    });

    it("overwrites a file cached under the same id", () => {
      // The force-refresh path re-fetches an alert whose content changed
      // upstream; the newer body must win rather than being ignored.
      store.commit("clearAlertLibrary");
      store.commit("setAlertLibraryFile", { id: "k8s/pod_oom_killed", file: { v: 1 } });
      store.commit("setAlertLibraryFile", { id: "k8s/pod_oom_killed", file: { v: 2 } });

      expect(store.state.alertLibrary.fileCache["k8s/pod_oom_killed"]).toEqual({ v: 2 });
    });

    it("accumulates alert files instead of replacing the cache", () => {
      // Opening a second drawer must not evict the first alert's file — the
      // gallery reopens drawers constantly while comparing alerts.
      store.commit("clearAlertLibrary");
      store.commit("setAlertLibraryFile", { id: "k8s/pod_oom_killed", file: { name: "a" } });
      store.commit("setAlertLibraryFile", { id: "k8s/pod_evicted", file: { name: "b" } });

      expect(Object.keys(store.state.alertLibrary.fileCache).sort()).toEqual([
        "k8s/pod_evicted",
        "k8s/pod_oom_killed",
      ]);
    });

    it("keys files by the stable library id, not the bare alert name", () => {
      // `id` is <pack>/<name>; two packs may legitimately ship the same name.
      store.commit("clearAlertLibrary");
      store.commit("setAlertLibraryFile", { id: "k8s/high_cpu", file: { name: "k8s one" } });
      store.commit("setAlertLibraryFile", { id: "aws/high_cpu", file: { name: "aws one" } });

      expect(store.state.alertLibrary.fileCache["k8s/high_cpu"]).toEqual({ name: "k8s one" });
      expect(store.state.alertLibrary.fileCache["aws/high_cpu"]).toEqual({ name: "aws one" });
    });

    it("drops manifest and files together when cleared", () => {
      // NOT for org switching: the library is a global public catalog, identical
      // for every org, and the org-specific half of a "Ready" verdict (the
      // stream list) lives in useStreams and is recomputed at render. This
      // exists for an explicit refresh and for teardown.
      //
      // Caveat worth knowing: the sibling `clearDashboardGallery` has ZERO call
      // sites in this repo — a mutation nobody invokes. If nothing ends up
      // calling this one either, delete it rather than leave the same fiction.
      store.commit("setAlertLibraryManifest", { format_version: "1.0.0", alerts: [] });
      store.commit("setAlertLibraryFile", { id: "k8s/pod_oom_killed", file: { name: "a" } });
      store.commit("clearAlertLibrary");

      expect(store.state.alertLibrary.manifest).toBeNull();
      expect(store.state.alertLibrary.lastFetched).toBeNull();
      expect(store.state.alertLibrary.fileCache).toEqual({});
    });
  });
});
