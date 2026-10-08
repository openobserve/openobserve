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
  Stands in for the whole team body while `fetchAll()` is still in flight.
  Before this existed, the page rendered its real tab strip and the Members
  panel — both driven by refs seeded with empty defaults rather than a loading
  state — so every click into a team flashed "No members yet" on a team that
  usually has members, before the fetch resolved and swapped it for the real
  tab and data.

  Mirrors the real layout's shape (attention banner, tab strip, overview
  cards) so the page has a size and a rhythm from the first frame.
-->
<template>
  <div
    role="status"
    :aria-label="t('oncall.teamDetailLoading')"
    aria-live="polite"
    data-test="oncall-team-detail-skeleton"
    class="flex flex-col gap-5"
  >
    <OCard variant="glass">
      <OCardSection dense class="flex flex-col gap-2">
        <OSkeleton type="text" class="h-4 w-1/3" />
        <OSkeleton type="text" class="h-4 w-1/2" />
      </OCardSection>
    </OCard>

    <div class="flex gap-4">
      <OSkeleton v-for="tab in 5" :key="tab" type="text" class="h-6 w-24" />
    </div>

    <div
      class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    >
      <OSkeleton type="text" class="h-4 w-40" />
      <OSkeleton type="rect" class="h-16 w-full" />
    </div>

    <OCard variant="glass">
      <OCardSection role="header" dense>
        <OSkeleton type="text" class="h-4 w-32" />
      </OCardSection>
      <OCardSection role="body" dense class="flex flex-col gap-2">
        <OSkeleton v-for="row in 3" :key="row" type="text" class="h-4 w-full" />
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>
