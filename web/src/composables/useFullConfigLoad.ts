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

import { reactive } from "vue";

/** The org whose full config is in the store, and the org whose last load failed; written by MainLayout's loader. */
export const fullConfigLoad = reactive({ loadedOrg: "", failedOrg: "" });

let loader: (() => Promise<void>) | null = null;

/** MainLayout registers its loader so a page's retry runs the same success path (menus, RUM). */
export const registerFullConfigLoader = (load: () => Promise<void>): (() => void) => {
  loader = load;
  fullConfigLoad.loadedOrg = "";
  fullConfigLoad.failedOrg = "";
  return () => {
    if (loader === load) loader = null;
  };
};

export const reloadFullConfig = async (): Promise<void> => {
  await loader?.();
};

export const markFullConfigLoaded = (org: string): void => {
  fullConfigLoad.loadedOrg = org;
  if (fullConfigLoad.failedOrg === org) fullConfigLoad.failedOrg = "";
};

export const markFullConfigFailed = (org: string): void => {
  fullConfigLoad.failedOrg = org;
};
