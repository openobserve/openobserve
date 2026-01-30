// Copyright 2025 OpenObserve Inc.
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

export interface ServiceGraphParams {
  streamName?: string;
  startTime?: number;
  endTime?: number;
}

const serviceGraphService = {
  /**
   * Get current service graph topology in JSON format
   * Stream-only implementation - NO in-memory metrics
   * @param orgId - Organization ID
   * @param options - Optional parameters (streamName, startTime, endTime)
   */
  getCurrentTopology: (orgId: string, options?: ServiceGraphParams) => {
    const params: Record<string, string | number> = {};

    if (options?.streamName && options.streamName !== "all") {
      params.stream_name = options.streamName;
    }
    if (options?.startTime) {
      params.start_time = options.startTime;
    }
    if (options?.endTime) {
      params.end_time = options.endTime;
    }

    return http().get(`/api/${orgId}/traces/service_graph/topology/current`, {
      params,
    });
  },
};

export default serviceGraphService;
