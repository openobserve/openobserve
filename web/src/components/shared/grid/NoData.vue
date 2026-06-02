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
  NoData — the app's shared "no data" placeholder. Now backed by the unified
  OEmptyState system (object illustration + consistent copy) so every list/table
  that renders <NoData /> gets the standardized empty state. Pass `title` to
  override the default message; for a richer, scenario-specific empty state use
  <OEmptyState preset="…" /> directly instead.
-->
<template>
  <div data-test="no-data-message" class="tw:w-full">
    <OEmptyState
      size="block"
      illustration="box"
      :title="title || t('ticket.noDataErrorMsg')"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

defineProps<{
  /** Optional override for the default "No data available" message. */
  title?: string;
}>();

const { t } = useI18n();
</script>
