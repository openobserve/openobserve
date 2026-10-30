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
  DbmSubheaderBand — one band between a DBM table's toolbar and its rows.

  The window's totals live INSIDE the table frame rather than in the page header,
  because they summarise exactly the rows below them: widen the filter and both
  move together. Five tables drew that band with the same edge padding and the
  same row divider; only the `data-test` differed.

  The slowest-calls scatter is deliberately not one of these — it sets its own
  height and full width, and a `height` prop for one caller buys nothing.
-->
<template>
  <div class="px-page-edge border-table-row-divider border-b py-1.5" :data-test="dataTest">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ dataTest: string }>();
</script>
