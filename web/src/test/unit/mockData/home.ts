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

export default {
  summary: {
    get: {
      streams: [
        {
          name: "quickstart1",
          storage_type: "disk",
          stream_type: "logs",
          stats: {
            doc_time_min: 1680695742353522,
            doc_time_max: 1680695754490493,
            doc_num: 30540,
            file_num: 1,
            storage_size: 55.92,
            compressed_size: 0.4,
          },
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            index_fields: [],
            bloom_filter_fields: [],
            defined_schema_fields: [],
            data_retention: 45,
          },
        },
      ],
      functions: [],
      alerts: [],
    },
  },
};
