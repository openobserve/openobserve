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
  ServicesCatalogNoDataState — empty state for the services catalog panel.
  Shows the services-catalog illustration. No widen-range action: the panel
  aggregates across the selected window, so widening would not reliably
  surface data and the suggestion was not useful.
-->
<template>
  <OEmptyState preset="no-services-catalog" size="block" :hide-action="true" />
</template>

<script setup lang="ts">
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
</script>
