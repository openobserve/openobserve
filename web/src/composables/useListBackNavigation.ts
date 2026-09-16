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

import { useRouter, type RouteLocationRaw } from "vue-router";

// Real browser back replays the listing's exact previous URL (any URL-synced state included); the fallback push is for when history.state.back isn't that listing at all (deep link, arrived from elsewhere).
export function useListBackNavigation(options: {
  isListPath: (path: string) => boolean;
  fallback: () => RouteLocationRaw;
}) {
  const router = useRouter();

  return function goBack(): void {
    const back = (router.options?.history?.state as { back?: unknown } | undefined)?.back;
    if (typeof back === "string") {
      // endsWith rather than === so a deployment served under a base path still matches.
      const path = back.split(/[?#]/)[0].replace(/\/$/, "");
      if (options.isListPath(path)) {
        router.back();
        return;
      }
    }
    router.push(options.fallback());
  };
}
