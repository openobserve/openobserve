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

/**
 * Manages schema caching for result_schema API calls.
 * Returns cache ref + clear function. Schema is keyed by query + streamType.
 */
export const manageSchemaCache = () => {
  const schemaCache = ref<{
    key: string;
    response: any;
  } | null>(null);

  const clearSchemaCache = () => {
    schemaCache.value = null;
  };

  return { schemaCache, clearSchemaCache };
};

/**
 * Manages field extraction abort controller.
 * Returns controller ref + cancel/start helpers to guard against stale responses.
 */
export const manageFieldExtraction = () => {
  const schemaRequestToken = ref(0);

  const startExtraction = (): number => {
    schemaRequestToken.value += 1;
    return schemaRequestToken.value;
  };

  const isStale = (token: number): boolean => {
    return token !== schemaRequestToken.value;
  };

  const cancelExtraction = () => {
    schemaRequestToken.value += 1;
  };

  return { schemaRequestToken, startExtraction, isStale, cancelExtraction };
};
