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

import { openobserveRum } from "@openobserve/browser-rum";
import { queryClient } from "@/composables/query/queryClient";
import { configFullQuery } from "@/services/config.queries";
import store from "@/stores";
import { initBrowserRum, isBrowserRumStarted, type BrowserRumConfig } from "./initBrowserRum";

/** Starts RUM on a signed-in page outside MainLayout from the org's full config; never rejects. */
export const ensureBrowserRum = async (orgIdentifier: string | undefined): Promise<void> => {
  if (!orgIdentifier || isBrowserRumStarted()) return;
  try {
    const fullConfig: { rum?: BrowserRumConfig } | undefined = await queryClient.fetchQuery(
      configFullQuery(orgIdentifier),
    );
    if (!initBrowserRum(fullConfig?.rum, store.state.API_ENDPOINT)) return;
    const userInfo: { email?: string; given_name?: string; family_name?: string } =
      store.state.userInfo;
    // Standalone pages never record replay; only MainLayout and sign-in start it.
    openobserveRum.setUser({
      id: userInfo.email,
      name: userInfo.given_name + " " + userInfo.family_name,
      email: userInfo.email,
    });
  } catch (error) {
    console.error("Failed to start RUM:", error);
  }
};
