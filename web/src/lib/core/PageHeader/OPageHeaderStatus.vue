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

<!-- Hosts the status an ancestor provides (see pageHeaderStatus.ts); place once at the start of a toolbar's right-aligned group. -->
<template>
  <span ref="hostEl" class="contents" data-test="o-page-header-status">
    <component :is="status" v-if="status" />
  </span>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { usePageHeaderStatusHost } from "@/lib/core/PageHeader/pageHeaderStatus";

const props = defineProps<{
  /** The app top bar's host: shows only a status that no page host took. */
  fallback?: boolean;
}>();

const hostEl = ref<HTMLElement | null>(null);
const status = usePageHeaderStatusHost(hostEl, props.fallback ? "fallback" : "page");
</script>
