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

// Chrome, Safari and Firefox wordings of a fetch body read that lost its connection.
const NETWORK_FAILURE_PATTERN = /network error|Load failed|Failed to fetch|NetworkError/i;

/** A dropped connection (offline, sleep, tab freeze) while reading a fetch body, which is not an app fault. */
export const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError && NETWORK_FAILURE_PATTERN.test(error.message);
