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

const sampleData = {
  ingestLogs: (org: string, stream: string, rows: unknown[]) =>
    http().post(`/api/${org}/${stream}/_json`, rows),
  ingestMetrics: (org: string, rows: unknown[]) =>
    http().post(`/api/${org}/ingest/metrics/_json`, rows),
  ingestTraces: (org: string, stream: string, payload: unknown) =>
    http({ headers: { "Content-Type": "application/json", "stream-name": stream } }).post(
      `/api/${org}/v1/traces`,
      payload,
    ),
};

export default sampleData;
