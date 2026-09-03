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

<!--
  Stands in for the whole response body while `GET /oncall/responses/:id` is
  still in flight. Before this existed, the header rendered (its title has a
  fallback) but the body was `v-if="response"` with no loading branch at all
  — a blank rectangle under a populated header from the moment a reader
  clicked into a page until the fetch resolved.

  Mirrors the real layout's shape (stat strip, then a 2-col grid of cards) so
  the page has a size and a rhythm from the first frame, rather than snapping
  into existence once data lands.
-->
<template>
  <div
    role="status"
    :aria-label="t('oncall.responseDetailLoading')"
    aria-live="polite"
    data-test="oncall-response-detail-skeleton"
  >
    <!-- Mirrors OStatCard's own shape (border, value + label row, chip, track)
         rather than OStatStrip's `loading` prop, which the component declares
         but never actually reads — passing it renders four dash-value tiles,
         not a skeleton. -->
    <div class="flex flex-wrap gap-2">
      <div
        v-for="tile in 4"
        :key="tile"
        class="rounded-default bg-surface-base border-border-default flex min-w-0 grow basis-52 flex-col justify-center gap-1 overflow-hidden border px-2.5 py-1"
      >
        <div class="flex min-w-0 items-center justify-between gap-2">
          <OSkeleton type="text" class="h-6 w-16" />
          <OSkeleton type="circle" class="h-7 w-7 shrink-0" />
        </div>
        <div class="bg-surface-subtle h-1 overflow-hidden rounded-full" />
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div class="flex flex-col gap-4 lg:col-span-2">
        <OCard variant="glass">
          <OCardSection role="header" dense>
            <OSkeleton type="text" class="h-4 w-24" />
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-2">
            <OSkeleton type="text" class="h-4 w-full" />
            <OSkeleton type="text" class="h-4 w-5/6" />
            <OSkeleton type="text" class="h-4 w-2/3" />
          </OCardSection>
        </OCard>
      </div>

      <div class="flex flex-col gap-4">
        <OCard v-for="card in 3" :key="card" variant="glass">
          <OCardSection role="header" dense>
            <OSkeleton type="text" class="h-4 w-32" />
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-2">
            <OSkeleton type="text" class="h-4 w-full" />
            <OSkeleton type="text" class="h-4 w-1/2" />
          </OCardSection>
        </OCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>
