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
  <span class="text-text-body text-sm">
    <template v-for="(range, i) in ranges" :key="rangeKey(range)">
      <span v-if="i > 0" class="text-text-secondary">{{ raw(" · ") }}</span>
      <span :class="isDefaultRange(link, range) ? 'font-semibold' : ''"
        >{{ raw(shortRange(range, timezone)) }}<OTooltip :content="longRange(range, t, timezone)"
      /></span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { PublicLink } from "@/services/public_dashboards_admin";
import { isDefaultRange, longRange, shortRange } from "./publicLinkDisplay";
import { rangeKey, sortRanges } from "./PublicLinkForm.schema";

const props = defineProps<{ link: PublicLink }>();

const store = useStore();
const { t } = useI18nTyped();
const timezone = computed<string>(
  () => store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
);
const ranges = computed(() => sortRanges(props.link.time_range.ranges));
</script>
