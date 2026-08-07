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
});
