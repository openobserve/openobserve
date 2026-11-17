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

<!-- An incident row's Muted tag: a link to the downtime when the lookup has its row, else plain. -->
<template>
  <RouterLink
    v-if="to"
    :to="to"
    class="inline-flex max-w-60 min-w-12 shrink-4"
    data-test="incident-list-muted-link"
    @click.stop
  >
    <OTag
      type="downtimeStatus"
      value="active"
      class="max-w-full min-w-0"
      data-test="incident-list-muted"
    >
      <span class="truncate">{{ label }}</span>
      <OTooltip :content="tooltip" />
    </OTag>
  </RouterLink>
  <OTag
    v-else
    type="downtimeStatus"
    value="active"
    class="max-w-60 min-w-12 shrink-4"
    data-test="incident-list-muted"
  >
    <span class="truncate">{{ label }}</span>
    <OTooltip :content="tooltip" />
  </OTag>
</template>

<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type { I18nText } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{
  label: I18nText;
  tooltip: I18nText;
  /** The downtime's detail page, or `null` when the lookup has no row. */
  to: RouteLocationRaw | null;
}>();
</script>
