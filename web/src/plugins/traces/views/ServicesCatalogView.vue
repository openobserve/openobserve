<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Standalone Services route (`/traces/services`).

  Header follows the Agent Graph page exactly — OPageLayout with
  title/subtitle/icon, a DateTime picker in #actions, and an ORefreshButton
  showing the last run time in the same bordered box (see
  enterprise/components/AIObservability/AiPageShell.vue). AiPageShell itself is
  not reused: it is bound to the AI section's `useAiDateRange` state, whereas
  the catalog reads the shared traces datetime.
-->
<template>
  <OPageLayout
    data-test="services-catalog-page"
    :title="t('menu.services')"
    :subtitle="t('traces.servicesCatalogSubtitle')"
    icon="menu-book"
    bleed
    :scroll="false"
  >
    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="searchObj.data.datetime.type"
        :default-absolute-time="{
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        }"
        :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
        data-test="services-catalog-date-time-picker"
        class="h-8"
        @on:date-change="onDateChange"
      />
      <div
        class="border-border-default rounded-default inline-flex h-8 items-center overflow-hidden border px-1"
      >
        <ORefreshButton
          :last-run-at="catalogRef?.lastRunAt ?? null"
          :loading="catalogRef?.loading ?? false"
          :disabled="catalogRef?.loading ?? false"
          data-test="services-catalog-refresh-btn"
          @click="catalogRef?.refresh()"
        />
      </div>
    </template>

    <ServicesCatalog
      ref="catalogRef"
      class="h-full"
      @view-traces="onViewTraces"
      @request:stream-change="onStreamChange"
      @jump-to-stream-data="onJumpToStreamData"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import DateTime from "@/components/DateTime.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import useTraces from "@/composables/useTraces";
import { viewTracesQuery, type ViewTracesPayload } from "../viewTracesHandoff";
import { applyUrlTimeRange } from "./useServiceViewTimeRange";

const ServicesCatalog = defineAsyncComponent(() => import("../ServicesCatalog.vue"));

const { t } = useI18nTyped();
const catalogRef = ref<any>(null);
const router = useRouter();
const store = useStore();
const { searchObj } = useTraces();

// The Traces page sets this inside loadPageData(); on these standalone routes
// nothing else does, and an empty org produces requests to `/api//_search`.
searchObj.organizationIdentifier = store.state.selectedOrganization?.identifier ?? "";
watch(
  () => store.state.selectedOrganization?.identifier,
  (id) => {
    if (id) searchObj.organizationIdentifier = id;
  },
);

// Honour ?period= / ?from=&to= before the catalog queries (these routes are
// deep-linked by tests and by shared links).
applyUrlTimeRange(router, searchObj.data.datetime);

/**
 * Hand off to the Traces route. The filter, stream, mode and time range travel
 * as query params (see `viewTracesQuery`) rather than as a mutation of the
 * shared store, so the resulting URL is bookmarkable and survives a reload.
 */
function onViewTraces(data: string | ViewTracesPayload) {
  router.push({
    name: "traces",
    query: {
      org_identifier: router.currentRoute.value.query.org_identifier,
      ...viewTracesQuery(data),
    },
  });
}

/**
 * Write the picked range into the shared traces datetime; the catalog watches
 * it and reloads itself.
 */
function onDateChange(value: any) {
  searchObj.data.datetime = {
    startTime: value.startTime,
    endTime: value.endTime,
    relativeTimePeriod: value.relativeTimePeriod
      ? value.relativeTimePeriod
      : searchObj.data.datetime.relativeTimePeriod,
    type: value.relativeTimePeriod ? "relative" : "absolute",
    queryRangeRestrictionMsg: searchObj.data.datetime?.queryRangeRestrictionMsg || "",
    queryRangeRestrictionInHour: searchObj.data.datetime?.queryRangeRestrictionInHour || 0,
  };
}

/**
 * On its own route there is no traces query editor to invalidate, so a stream
 * change applies directly — no "you will lose your query" confirmation.
 */
function onStreamChange(newStream: string) {
  searchObj.data.stream.selectedStream = { label: newStream, value: newStream };
}

function onJumpToStreamData(fromUs: number, toUs: number) {
  searchObj.data.datetime.startTime = fromUs;
  searchObj.data.datetime.endTime = toUs;
  searchObj.data.datetime.type = "absolute";
  searchObj.data.datetime.relativeTimePeriod = null;
}
</script>
