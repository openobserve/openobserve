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

import { ref } from "vue";
import searchService from "@/services/search";
import logErrorAndNotify from "@/utils/errorHandler";

interface SchemaResponse {
  [key: string]: any;
}

// Singleton cache shared across component instances
const schemaCache = ref<Map<string, SchemaResponse>>(new Map());
const pendingRequests = new Map<string, Promise<SchemaResponse | null>>();

const useStreamSchemas = () => {
  const getSchema = async (
    query: string,
    streamType: string,
    orgId: string,
  ): Promise<SchemaResponse | null> => {
    const key = `${orgId}:${streamType}:${query}`;

    // Return cached result
    if (schemaCache.value.has(key)) {
      return schemaCache.value.get(key)!;
    }

    // In-flight deduplication
    if (pendingRequests.has(key)) {
      return pendingRequests.get(key)!;
    }

    const request = searchService
      .result_schema({
        query,
        stream_type: streamType,
        org_identifier: orgId,
      })
      .then((res: any) => {
        const schema = res.data;
        schemaCache.value.set(key, schema);
        return schema;
      })
      .catch((err: unknown) => {
        logErrorAndNotify("useStreamSchemas.getSchema", err);
        return null;
      })
      .finally(() => {
        pendingRequests.delete(key);
      });

    pendingRequests.set(key, request);
    return request;
  };

  const clearCache = (): void => {
    schemaCache.value.clear();
    pendingRequests.clear();
  };

  return {
    getSchema,
    clearCache,
    schemaCache,
  };
};

export default useStreamSchemas;
