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
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import type { SyntheticPrefillView } from "./useSyntheticPrefill";
import SyntheticPrefillBanner from "./SyntheticPrefillBanner.vue";
import AfterSavePanel from "./AfterSavePanel.vue";

defineProps<{
  view: SyntheticPrefillView | null;
  routes: { home: RouteLocationRaw; service: RouteLocationRaw } | null;
  /** Narrow screens get the banner and panel inside the form's own scroll instead. */
  wide: boolean;
}>();
</script>

<template>
  <!-- Without a prefill only the slot renders, so the plain form keeps its exact markup. -->
  <div
    v-if="view && routes && wide"
    class="flex min-h-0 flex-1 flex-col"
    data-test="synthetics-prefill-frame"
  >
    <SyntheticPrefillBanner
      class="shrink-0 px-6 pt-3"
      :service="view.service"
      :where="view.where"
      :routes="routes"
    />
    <div class="flex min-h-0 flex-1">
      <slot />
      <div class="w-80 shrink-0 overflow-y-auto py-4 pe-6">
        <AfterSavePanel :view="view" :service-route="routes.service" />
      </div>
    </div>
  </div>
  <slot v-else />
</template>
