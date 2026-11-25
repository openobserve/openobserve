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

// Coverage-instrumented CI runners measure about 4x slower on every input; 6x leaves headroom.
export const CI_TIME_FACTOR = process.env.CI === "true" ? 6 : 1;

/** Scales a local wall-clock budget in ms for the current runner. */
export const timeBudget = (localMs: number): number => localMs * CI_TIME_FACTOR;
