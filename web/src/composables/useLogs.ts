// Copyright 2023 OpenObserve Inc.
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

/**
 * Backward compatibility wrapper for useLogs composable
 *
 * This file maintains the original import path while redirecting
 * to the new modular implementation in useLogs/index.ts
 *
 * The original 6,876-line file has been refactored into multiple
 * smaller, maintainable modules while preserving the exact same API.
 */

// Import the refactored composable from the new location
export { useLogs as default } from "@/composables/useLogs/index";
export { useLogs } from "@/composables/useLogs/index";