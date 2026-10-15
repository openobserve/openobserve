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

import http from "./http";

const PING_TIMEOUT_MS = 5000;

/** True when the backend answers at all; a 5xx from a proxy in front of it counts as down. */
export const pingBackend = async (): Promise<boolean> => {
  try {
    const response = await http().get("/healthz", {
      timeout: PING_TIMEOUT_MS,
      validateStatus: () => true,
    });
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
};

export default { pingBackend };
