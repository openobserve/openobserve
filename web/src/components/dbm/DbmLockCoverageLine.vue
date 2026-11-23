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

  A banner with a sentence, and — when there is one — a middot and a timestamp. Both
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
  <OBanner
    v-if="variant"
    :variant="variant"
    :icon="variant === 'warning' ? 'warning-amber' : 'info-outline'"
    bar
    dense
    class="shrink-0"
    :data-test="dataTest"
  >
    <span>{{ summary }}</span>
    <template v-if="trailingLabel">
      <span class="opacity-45"> · </span>
      <span>{{ trailingLabel }}</span>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The claim: how much of the window this list actually covers. */
    summary: I18nText;
    /** A capped read is a warning; `null` renders nothing, for a complete all-good read. */
    variant: "warning" | "info" | null;
    /** When the read was taken, if the page knows. Absent renders no middot. */
    trailingLabel?: I18nText | null;
    dataTest: string;
  }>(),
  { trailingLabel: null },
);
</script>
