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

import { ref } from "vue";
import { vi } from "vitest";

/** Shared stand-in for `useStepOptions`, so the specs drive the picker's list without a server. */
export const stepOptions = {
  options: ref<Record<string, unknown>[]>([]),
  groups: ref<Record<string, unknown>[]>([]),
  loading: ref(false),
  failed: ref(false),
  noCustom: ref(false),
  load: vi.fn(async () => {}),
  onSearch: vi.fn(async () => {}),
};

export const useStepOptionsMock = vi.fn(
  (_opts: { events: () => unknown; kinds: () => unknown }) => stepOptions,
);

export function resetStepOptions(
  options: Record<string, unknown>[],
  groups: Record<string, unknown>[] = [],
) {
  stepOptions.options.value = options;
  stepOptions.groups.value = groups;
  stepOptions.loading.value = false;
  stepOptions.failed.value = false;
  stepOptions.noCustom.value = false;
  stepOptions.load.mockClear();
  stepOptions.onSearch.mockClear();
  useStepOptionsMock.mockClear();
}
