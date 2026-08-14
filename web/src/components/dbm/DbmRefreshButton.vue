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
  DbmRefreshButton — the reload control every DBM list table puts in its
  `#toolbar-trailing` slot.

  Nine tables carried a byte-identical copy of this button, differing only in
  their `data-test`. OTable renders `#toolbar` and `#toolbar-trailing` on either
  side of its own column-toggle, so the toolbar's two halves cannot be one
  component without moving the toggle; this owns the trailing half and
  DbmTableToolbar owns the leading one.
-->
<template>
  <OButton
    variant="outline"
    size="icon-sm"
    icon-left="refresh"
    :loading="loading"
    :class="shrink ? 'shrink-0' : undefined"
    :data-test="dataTest"
    @click="emit('refresh')"
  >
    <OTooltip side="bottom" :content="t('dbm.common.reload')" />
  </OButton>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** Spins the button while the page's fetch is in flight. */
    loading?: boolean;
    dataTest: string;
    /**
     * `shrink-0` pins the button's width inside the flex toolbar. Table health
     * puts a bare search input in the slot rather than a flex row, so it never
     * carried the class and opts out here.
     */
    shrink?: boolean;
  }>(),
  { loading: false, shrink: true },
);

const emit = defineEmits<{ refresh: [] }>();

const { t } = useI18nTyped();
</script>
