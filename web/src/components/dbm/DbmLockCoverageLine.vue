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
  DbmLockCoverageLine — what the two lock pages know about their own completeness.

  A dot, a sentence, and — when there is one — a middot and a timestamp. Both
  lock pages drew the identical twelve lines, differing only in what the dot is
  keyed on and which two strings go in.

  NOT `DbmCoverageLine`, which looks similar and is not: that one DERIVES its
  sentence from a freshness envelope the query and database lists carry, with an
  estimated-percentile chain and a coverage bar. These pages have no such
  envelope — the deadlock log either was read to the cap or was not — so their
  sentence is computed on the page and only the band is shared. Merging them
  would mean one component with two disjoint data models and one shared name.
-->
<template>
  <div
    class="border-border-subtle bg-surface-base text-text-secondary text-2xs px-page-edge flex shrink-0 items-center gap-2 border-b py-1"
    :data-test="dataTest"
  >
    <span class="size-1.5 shrink-0 rounded-full" :class="dotClass"></span>
    <span>{{ summary }}</span>
    <template v-if="trailingLabel">
      <span class="opacity-45">·</span>
      <span>{{ trailingLabel }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The claim: how much of the window this list actually covers. */
    summary: I18nText;
    /**
     * A capped read is warning-toned, a complete one is not. Passed as a class
     * because the two pages decide it on different facts — deadlocks on whether
     * the read hit its cap, blocked queries on there being a sample at all.
     */
    dotClass: string;
    /** When the read was taken, if the page knows. Absent renders no middot. */
    trailingLabel?: I18nText | null;
    dataTest: string;
  }>(),
  { trailingLabel: null },
);
</script>
