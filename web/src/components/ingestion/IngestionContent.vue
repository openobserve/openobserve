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
  Shared wrapper for ingestion (data source) detail pages.

  It centralizes the page padding and the vertical rhythm between sections
  (code blocks, doc links, notes) so every data-source tab looks identical.
  Tune `p-3` / `gap-4` here to retune the spacing of ALL data-source
  detail pages at once.
-->
<template>
  <div class="p-3 flex flex-col gap-4 text-sm">
    <slot />
  </div>
</template>

<script setup lang="ts">
// Layout-only wrapper — no props or logic.
</script>
