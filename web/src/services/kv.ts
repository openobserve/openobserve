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

const kvPath = (org: string, key: string) => `/api/${org}/kv/${encodeURIComponent(key)}`;

const kv = {
  list: (org: string, prefix: string) => http().get(`/api/${org}/kv`, { params: { prefix } }),
  // A string response type stops axios parsing a stored value on the way in.
  get: (org: string, key: string) => http().get(kvPath(org, key), { responseType: "text" }),
  // Callers report a refused write themselves.
  set: (org: string, key: string, value: string) =>
    http().post(kvPath(org, key), value, {
      headers: { "Content-Type": "text/plain" },
      silentForbidden: true,
    }),
  delete: (org: string, key: string) => http().delete(kvPath(org, key)),
};

export default kv;
