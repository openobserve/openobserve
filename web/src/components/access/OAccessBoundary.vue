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

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <!-- Hidden, not unmounted: the page's own reads keep running and a later success lifts the lock. -->
    <div v-show="!takesOver" class="min-h-0 flex-1">
      <slot />
    </div>
    <div
      v-if="takesOver"
      class="flex min-h-0 flex-1 items-center justify-center"
      data-test="access-boundary-denied"
    >
      <OAccessLock
        :denials="lockDenials"
        :requests="pageRequests"
        size="hero"
        data-test="access-boundary-empty-state"
      />
    </div>
  </div>
  <OAccessActionPopover v-if="!nested" />
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, toRaw } from "vue";
import { matchedRouteKey, useRoute } from "vue-router";
import { providePageHeaderStatus } from "@/lib/core/PageHeader/pageHeaderStatus";
import OAccessActionPopover from "@/components/access/OAccessActionPopover.vue";
import OAccessHeaderChip from "@/components/access/OAccessHeaderChip.vue";
import OAccessLock from "@/components/access/OAccessLock.vue";
import {
  accessBoundaryKey,
  registerAccessBoundary,
  useAccessBoundary,
  type AccessDenial,
} from "@/composables/useAccessStore";

const { pageDenied, pageDenial, pageRequests, sectionEntries, deepestBoundary } =
  useAccessBoundary();
const route = useRoute();
const nested = inject(accessBoundaryKey, false);
provide(accessBoundaryKey, true);

// The record this boundary's router-view renders; only the level that renders the record declaring the resource takes over, so parent chrome stays.
const renderedRecord = inject(matchedRouteKey, null);
const takesOver = computed(
  () =>
    pageDenied.value &&
    !!renderedRecord?.value &&
    toRaw(renderedRecord.value) === toRaw(route.matched[route.matched.length - 1]),
);

// Section denials show once, from the innermost boundary on screen, so a shell's own header does not repeat them.
const depth = computed(() => {
  const record = renderedRecord?.value;
  return record ? route.matched.findIndex((r) => toRaw(r) === toRaw(record)) : -1;
});
onBeforeUnmount(registerAccessBoundary(depth));
const showsChip = computed(
  () =>
    depth.value >= 0 &&
    depth.value === deepestBoundary.value &&
    !pageDenied.value &&
    sectionEntries.value.length > 0,
);
providePageHeaderStatus(
  () => (showsChip.value ? OAccessHeaderChip : null),
  () => route.fullPath,
);

const lockDenials = computed<AccessDenial[]>(() => (pageDenial.value ? [pageDenial.value] : []));
</script>
