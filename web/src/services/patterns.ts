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

const patterns = {
  /**
   * Extract patterns from logs using the dedicated patterns API
   * @param org_identifier - Organization ID
   * @param stream_name - Stream name
   * @param query - Search query (same format as _search endpoint)
   * @returns Promise with pattern extraction results
   */
  extractPatterns: ({
    org_identifier,
    stream_name,
    query,
  }: {
    org_identifier: string;
    stream_name: string;
    query: any;
  }) => {
    const url = `/api/${org_identifier}/streams/${stream_name}/patterns/extract`;

    return http().post(url, query);
  },
};

export default patterns;
