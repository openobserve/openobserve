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

import { generateTraceContext } from "@/utils/zincutils";
import http from "../http";

/**
 * Interface for saved view parameters
 */
export interface SavedViewParams {
  org_identifier: string;
  view_id?: string;
  name?: string;
  view_data?: any;
}

/**
 * Saved views API service for managing saved search views
 */
export const savedViewsApi = {
  /**
   * Gets all saved views for an organization
   */
  get: (org_identifier: string) => {
    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).get(`/api/${org_identifier}/saved_views`);
  },

  /**
   * Creates a new saved view
   */
  create: (params: SavedViewParams) => {
    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).post(
      `/api/${params.org_identifier}/saved_views`,
      {
        name: params.name,
        view_data: params.view_data,
      }
    );
  },

  /**
   * Updates an existing saved view
   */
  update: (params: SavedViewParams) => {
    if (!params.view_id) {
      throw new Error("view_id is required for updating a saved view");
    }

    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).put(
      `/api/${params.org_identifier}/saved_views/${params.view_id}`,
      {
        name: params.name,
        view_data: params.view_data,
      }
    );
  },

  /**
   * Deletes a saved view
   */
  delete: (params: SavedViewParams) => {
    if (!params.view_id) {
      throw new Error("view_id is required for deleting a saved view");
    }

    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).delete(
      `/api/${params.org_identifier}/saved_views/${params.view_id}`
    );
  },

  /**
   * Gets a specific saved view by ID
   */
  getById: (params: SavedViewParams) => {
    if (!params.view_id) {
      throw new Error("view_id is required for getting a saved view");
    }

    const traceparent = generateTraceContext()?.traceparent;
    return http({ headers: { traceparent } }).get(
      `/api/${params.org_identifier}/saved_views/${params.view_id}`
    );
  },
};

export default savedViewsApi;