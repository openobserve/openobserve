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

import store from "../stores";
import { addLicenseDeniedError } from "@/composables/useUnauthorizedErrorGrouper";
import { markLicenseDenial } from "@/composables/useFeatureLock";
import { licenseDeniedFeatures } from "@/utils/featureGate";

/** Sends a license denial (403 + 40001) to the top bar; true when the error was one. */
export const receiveLicenseDenial = (error: unknown, requestStartedAt?: number): boolean => {
  const features = licenseDeniedFeatures(error);
  if (!features) return false;
  markLicenseDenial(error);
  addLicenseDeniedError(features, requestStartedAt);
  return true;
};

/** Wraps `window.fetch` so raw-fetch API calls reach the same license-denial receiver as axios. */
export const installFetchLicenseReceiver = (): void => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const startedAt = Date.now();
    const response = await nativeFetch(...args);
    if (response.status !== 403) return response;
    try {
      if (response.url.startsWith(new URL(store.state.API_ENDPOINT, window.location.origin).href)) {
        // Awaited so the denial is marked before the caller can toast its message.
        receiveLicenseDenial(
          { response: { status: 403, data: await response.clone().json() } },
          startedAt,
        );
      }
    } catch {
      // A body that is not JSON is not a license denial.
    }
    return response;
  };
};
