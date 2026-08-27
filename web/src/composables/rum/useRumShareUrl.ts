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
import { useRoute, useRouter } from "vue-router";

// Every RUM page already pushes its full state (time range, query, filters, ids)
// into the router query, so the live location IS the shareable link — no page
// needs to rebuild its params a second time and risk drifting from the real one.
export function useRumShareUrl(): { shareUrl: ComputedRef<string> } {
  const route = useRoute();
  const router = useRouter();

  // resolve() re-applies the router base, so this stays correct when the app is
  // served under a sub-path such as /web/.
  const shareUrl = computed(() => window.location.origin + router.resolve(route.fullPath).href);

  return { shareUrl };
}
