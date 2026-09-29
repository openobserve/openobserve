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

import type { SyntheticsEnvironment } from "@/types/synthetics";
import { MAX_CHECK_ENVIRONMENTS } from "@/constants/synthetics";

export function toggleEnvironment(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

export function atEnvironmentCap(selected: string[]): boolean {
  return selected.length >= MAX_CHECK_ENVIRONMENTS;
}

/** Selected ids the user cannot read; they stay selected because nobody here may drop them. */
export function lockedEnvironmentIds(
  selected: string[],
  environments: SyntheticsEnvironment[],
): string[] {
  return selected.filter((id) => !environments.some((env) => env.id === id));
}
