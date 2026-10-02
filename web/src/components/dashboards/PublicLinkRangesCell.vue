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
    <template v-for="(secs, i) in ranges" :key="secs">
      <span v-if="i > 0" class="text-text-secondary">{{ raw(" · ") }}</span>
      <span :class="secs === defaultRange(link) ? 'font-semibold' : ''">{{
        raw(shortRange(secs))
      }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";
import type { PublicLink } from "@/services/public_dashboards_admin";
import { defaultRange, shortRange } from "./publicLinkDisplay";

const props = defineProps<{ link: PublicLink }>();

const ranges = computed(() =>
  props.link.time_range.editable
    ? props.link.time_range.allowed_presets_secs
    : [defaultRange(props.link)],
);
</script>
