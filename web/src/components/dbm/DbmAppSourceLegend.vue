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
  DbmAppSourceLegend — the one-line key for DbmAppSourceMarker, shown on every
  view where the marker can appear.
-->
<template>
  <span class="text-text-secondary text-2xs flex min-w-0 items-center gap-1" :data-test="dataTest">
    <OIcon name="account-tree" size="xs" class="shrink-0" aria-hidden="true" />
    <span class="min-w-0 truncate" :data-test="`${dataTest}-text`">{{ text }}</span>
    <OTooltip :content="hint" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** This view's own wording, when it says more than the default key. */
    label?: I18nText;
    dataTest?: string;
  }>(),
  { label: undefined, dataTest: "dbm-app-source-legend" },
);

const { t } = useI18nTyped();
const text = computed(() => props.label ?? t("dbm.appSource.legend"));
// The short default leans on the marker's full sentence; a view's own wording is its own hint.
const hint = computed(() => props.label ?? t("dbm.appSource.markerHint"));
</script>
