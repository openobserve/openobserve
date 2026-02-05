// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import http from "./http";

const traces = {
  getTraceDAG: (
    org_identifier: string,
    stream_name: string,
    trace_id: string,
    start_time: number,
    end_time: number
  ) => {
    const url = `/api/${org_identifier}/${stream_name}/traces/${trace_id}/dag?start_time=${start_time}&end_time=${end_time}`;
    return http().get(url);
  },
};

export default traces;
