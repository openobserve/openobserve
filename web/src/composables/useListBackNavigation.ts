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

import { computed, type ComputedRef } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";

// A login bounce or OAuth callback is a redirect the user never chose, so no back button may return to one.
const AUTH_PATHS = new Set(["/login", "/logout", "/cb", "/slack/oauth/callback"]);

export interface ListBackNavigation {
  (): void;
  // Lets a caller word the button for where it will actually land, instead of always naming the listing.
  popsHistory: ComputedRef<boolean>;
}

// Any in-app page can link into a detail view, so real browser back — which replays the previous URL with all its URL-synced state — is right by default; the fallback is for a deep link, a new tab, or an entry point isExcluded rejects because going there would dead-end or loop.
export function useListBackNavigation(options: {
  isExcluded?: (path: string) => boolean;
  fallback: () => RouteLocationRaw;
}): ListBackNavigation {
  const router = useRouter();

  const backPath = (): string | null => {
    const back = (router.options?.history?.state as { back?: unknown } | undefined)?.back;
    // state.back is stored base-stripped, so a leading "/" is what separates a real route from a cross-origin referrer.
    if (typeof back !== "string" || !back.startsWith("/")) return null;
    return back.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  };

  const canPop = (): boolean => {
    const path = backPath();
    return path !== null && !AUTH_PATHS.has(path) && !options.isExcluded?.(path);
  };

  const goBack = (): void => {
    if (canPop()) {
      router.back();
      return;
    }
    router.push(options.fallback());
  };

  return Object.assign(goBack, { popsHistory: computed(canPop) }) as ListBackNavigation;
}
