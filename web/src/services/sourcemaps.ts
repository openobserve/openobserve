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

import http from "./http";

interface TranslateStackTraceRequest {
  stacktrace: string;
  service?: string;
  version?: string;
  env?: string;
}

interface StackTraceFrame {
  error: string;
  stack: Array<{
    line?: string;
    source?: string;
    source_line_start?: number;
    source_line_end?: number;
    stack_line?: number;
    stack_col?: number;
    source_info?: {
      source: string;
      source_line_start: number;
      source_line_end: number;
      stack_line: number;
      stack_col: number;
    };
  }>;
}

interface TranslateStackTraceResponse {
  stacktrace: StackTraceFrame[] | StackTraceFrame;
}

const sourcemapsService = {
  translateStackTrace: (
    org_identifier: string,
    data: TranslateStackTraceRequest
  ): Promise<{ data: TranslateStackTraceResponse }> => {
    const url = `/api/${org_identifier}/sourcemaps/stacktrace`;
    return http().post(url, data);
  },

  listSourceMaps: (
    org_identifier: string,
    params?: { version?: string; service?: string; env?: string }
  ): Promise<{ data: any[] }> => {
    const url = `/api/${org_identifier}/sourcemaps`;
    return http().get(url, { params });
  },

  uploadSourceMaps: (
    org_identifier: string,
    formData: FormData
  ): Promise<{ data: any }> => {
    const url = `/api/${org_identifier}/sourcemaps`;
    return http().post(url, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  },

  deleteSourceMaps: (
    org_identifier: string,
    params: { version: string; service: string; env: string }
  ): Promise<{ data: any }> => {
    const url = `/api/${org_identifier}/sourcemaps`;
    return http().delete(url, { params });
  },

  getSourceMapsValues: (
    org_identifier: string
  ): Promise<{ data: { services: string[]; envs: string[]; versions: string[] } }> => {
    const url = `/api/${org_identifier}/sourcemaps/values`;
    return http().get(url);
  },
};

export default sourcemapsService;
