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
  DbmQueryCell — a statement with WHERE IT RAN under it.

  The pattern four list tables share: one truncated monospace line carrying the
  SQL, and a smaller line beneath naming the engine and the places, separated by
  faint middots. The statement stays truncated rather than wrapping because a
  three-line SQL row destroys the scannability of the column beside it; the full
  text rides in the title attribute.

  Deliberately NOT used by three other cells that look similar and are not:
  deadlocks renders a query PAIR with a ⇄ between two statements, blocked
  queries puts a pill line above the statement and indents by chain depth, and
  the databases overview leads with the instance name rather than a statement.
  Each of those has a first line this component cannot produce, and forcing them
  through it would mean a slot that replaces everything above the meta row.
-->
<template>
  <div class="flex min-w-0 flex-col gap-px">
    <span class="text-text-code min-w-0 truncate font-mono text-xs" :title="titleAttr">{{
      text || raw("—")
    }}</span>
    <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
      <OTag v-if="dbSystem" type="dbSystem" :value="dbSystem" size="xs" />
      <template v-for="item in shownItems" :key="item.key">
        <span class="opacity-45">·</span>
        <span :class="item.class">{{ item.label }}</span>
      </template>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, type I18nText } from "@/types/i18n";

/**
 * One middot-separated fact about where the call ran. `class` exists because a
 * couple of these are not neutral — an over-long transaction age is warning-
 * toned in place, and duplicating the whole row to say so would be worse.
 */
export interface DbmQueryCellMeta {
  key: string;
  label: I18nText;
  class?: string;
}

const props = withDefaults(
  defineProps<{
    /** The statement. Empty renders the em-dash placeholder rather than a blank row. */
    text: I18nText;
    /** Full text for the title attribute — the truncated line is not the whole story. */
    titleAttr?: string;
    /**
     * Engine tag. Optional because the slowest-calls list can hold a call whose
     * system never arrived, and an empty tag there would read as a system.
     */
    dbSystem?: string | null;
    metaItems?: DbmQueryCellMeta[];
  }>(),
  { titleAttr: undefined, dbSystem: null, metaItems: () => [] },
);

/** A blank fact prints as a bare middot, which reads as missing data rather than absent. */
const shownItems = computed(() => props.metaItems.filter((item) => item.label));
</script>
