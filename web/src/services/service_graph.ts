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

const serviceGraphService = {
  /**
   * Get service graph metrics in Prometheus format
   * @param orgId - Organization ID
   * @param streamName - Optional stream name to filter metrics
   */
  getMetrics: (orgId: string, streamName?: string) => {
    const params = streamName && streamName !== 'all' ? { stream_name: streamName } : {};
    return http().get(`/api/${orgId}/traces/service_graph/metrics`, { params });
  },

  /**
   * Get service graph store statistics
   */
  getStats: (orgId: string) => {
    return http().get(`/api/${orgId}/traces/service_graph/stats`);
  },
};

export default serviceGraphService;
