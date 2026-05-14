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

import { useStore } from "vuex";
import TransformService from "@/services/jstransform";
import logErrorAndNotify from "@/utils/errorHandler";

// Singleton in-flight deduplication
let fetchPromise: Promise<void> | null = null;

const useFunctions = () => {
  const store = useStore();

  const getOrgId = (): string => store.state.selectedOrganization.identifier;

  const getAllFunctions = async (): Promise<void> => {
    if (fetchPromise) return fetchPromise;

    const orgId = getOrgId();

    // Return early if already cached in store
    if (store.state.organizationData?.functions?.length > 0) return;

    fetchPromise = TransformService.list(1, 100000, "name", false, "", orgId)
      .then((res: any) => {
        store.dispatch("setFunctions", res.data.list);
      })
      .catch((e: unknown) => {
        logErrorAndNotify("useFunctions.getAllFunctions", e);
      })
      .finally(() => {
        fetchPromise = null;
      });

    return fetchPromise;
  };

  const invalidateCache = (): void => {
    store.dispatch("setFunctions", []);
    fetchPromise = null;
  };

  const createFunction = async (data: any): Promise<void> => {
    const orgId = getOrgId();
    await TransformService.create(orgId, data);
    invalidateCache();
    await getAllFunctions();
  };

  const updateFunction = async (data: any): Promise<void> => {
    const orgId = getOrgId();
    await TransformService.update(orgId, data);
    invalidateCache();
    await getAllFunctions();
  };

  const deleteFunction = async (
    name: string,
    force?: boolean,
  ): Promise<void> => {
    const orgId = getOrgId();
    await TransformService.delete(orgId, name, force);
    invalidateCache();
    await getAllFunctions();
  };

  return {
    getAllFunctions,
    createFunction,
    updateFunction,
    deleteFunction,
    invalidateCache,
  };
};

export default useFunctions;
