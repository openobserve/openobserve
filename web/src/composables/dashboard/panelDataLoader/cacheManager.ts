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

import { toRaw } from "vue";
import { usePanelCache } from "../usePanelCache";
import { isEqual, omit } from "lodash-es";
import type { PanelState } from "./types";

export class CacheManager {
  private panelCache: ReturnType<typeof usePanelCache>;

  constructor(
    private state: PanelState,
    private panelSchema: any,
    private variableManager: any,
    private selectedTimeObj: any,
    private forceLoad: any,
    private dashboardId: any,
    private folderId: any,
  ) {
    this.panelCache = usePanelCache(
      folderId?.value,
      dashboardId?.value,
      panelSchema.value.id,
    );
  }

  getCacheKey() {
    return {
      panelSchema: toRaw(this.panelSchema.value),
      variablesData: JSON.parse(
        JSON.stringify(this.variableManager.getCurrentDependentVariablesData()),
      ),
      forceLoad: toRaw(this.forceLoad.value),
      dashboardId: toRaw(this.dashboardId?.value),
      folderId: toRaw(this.folderId?.value),
    };
  }

  async saveCurrentStateToCache() {
    await this.panelCache.savePanelCache(
      this.getCacheKey(),
      { ...toRaw(this.state) },
      {
        start_time: this.selectedTimeObj?.value?.start_time?.getTime(),
        end_time: this.selectedTimeObj?.value?.end_time?.getTime(),
      },
    );
  }

  async restoreFromCache(): Promise<boolean> {
    const cache = await this.panelCache.getPanelCache();

    if (!cache) {
      return false;
    }

    const { key: tempPanelCacheKey, value: tempPanelCacheValue } = cache;
    let isRestoredFromCache = false;

    const keysToIgnore = [
      "panelSchema.version",
      "panelSchema.layout",
      "panelSchema.htmlContent",
      "panelSchema.markdownContent",
    ];

    if (
      tempPanelCacheValue &&
      Object.keys(tempPanelCacheValue).length > 0 &&
      isEqual(
        omit(this.getCacheKey(), keysToIgnore),
        omit(tempPanelCacheKey, keysToIgnore),
      )
    ) {
      this.state.data = tempPanelCacheValue.data;
      this.state.loading = tempPanelCacheValue.loading;
      this.state.errorDetail = tempPanelCacheValue.errorDetail;
      this.state.metadata = tempPanelCacheValue.metadata;
      this.state.resultMetaData = tempPanelCacheValue.resultMetaData;
      this.state.annotations = tempPanelCacheValue.annotations;
      this.state.lastTriggeredAt = tempPanelCacheValue.lastTriggeredAt;
      this.state.isPartialData = tempPanelCacheValue.isPartialData;
      this.state.isOperationCancelled = tempPanelCacheValue.isOperationCancelled;

      isRestoredFromCache = true;

      if (
        this.selectedTimeObj?.value?.end_time -
          this.selectedTimeObj?.value?.start_time !==
        cache?.cacheTimeRange?.end_time - cache?.cacheTimeRange?.start_time
      ) {
        this.state.isCachedDataDifferWithCurrentTimeRange = true;
      }
    }

    return isRestoredFromCache;
  }
}
