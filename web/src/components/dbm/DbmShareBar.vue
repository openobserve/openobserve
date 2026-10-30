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
  DbmShareBar — a share of the whole, as a length.

  A track with a fill inside it, because both lock pages need the ABSENT part to
  stay visible: a bare fill (which is what the table library's ODataBarCell
  draws) makes "3% of waits" and "3% of a short column" look the same. The two
  pages hand-drew the identical seven lines, so this is that markup with the two
  things that genuinely differ — the track's size and the fill's tone — as props.

  The tone is a class rather than a variant name because the two callers pick it
  on different axes: deadlocks on a boolean severity, blocked queries on a
  threshold over the share itself.
-->
<template>
  <span class="bg-surface-subtle overflow-hidden rounded-full" :class="trackClass">
    <span class="block h-full rounded-full" :class="fillClass" :style="shareWidth(share)"></span>
  </span>
</template>

<script setup lang="ts">
import { shareWidth } from "@/utils/dbm/format";

defineProps<{
  /** 0–1. Anything above 1 simply fills the track. */
  share: number;
  /** The track's own size and spacing — the callers size it to their column. */
  trackClass: string;
  /** The fill's colour, already resolved by the page's own severity rule. */
  fillClass: string;
}>();
</script>
