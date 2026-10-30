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
  DbmStateNote — a card that has nothing to show, and why.

  Two lines: what happened, then what it means. Six of these stand inside the
  query detail page's cards — a failed read, an ambiguous join, an unmatched
  fingerprint, and the three reasons a plan section can be empty — and every one
  of them was hand-written to the same two type sizes.

  Muted, never error styling, at every site. Five of the six are ORDINARY
  outcomes, not failures: the server legitimately sees statements no
  instrumented client issued, and the database cannot EXPLAIN a `COMMIT`.
  Styling them as errors sends a reader off to fix something that is not broken.

  Deliberately not `DbmEmptyState`: that is the list pages' self-diagnosing
  checklist, which asks a reader to work through several possible causes. Here
  the cause is already known — the page just says which one it is.
-->
<template>
  <div :class="containerClass">
    <span class="text-text-secondary text-sm">{{ title }}</span>
    <span v-if="hint" class="text-text-muted text-xs">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** What happened, in one sentence. */
    title: I18nText;
    /** What it means, or where the fix is. */
    hint?: I18nText;
    /**
     * `inline` tucks the note under a card's heading, where the heading has
     * already been paid for. `centered` fills a card that has no other content
     * at all, so the note has to carry the whole card's height.
     */
    placement?: "inline" | "centered";
  }>(),
  { hint: undefined, placement: "inline" },
);

const containerClass = computed(() =>
  props.placement === "centered"
    ? "flex flex-col gap-1 p-6 text-center"
    : "flex flex-col gap-1 px-3 pb-3",
);
</script>
