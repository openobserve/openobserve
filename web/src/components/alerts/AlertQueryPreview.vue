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
  AlertQueryPreview — an alert's whole query, read-only and highlighted.

  One implementation for every surface that shows the query the alert will
  actually run: the create/edit alert page's "view the alert query" hint and the
  alert library's detail drawer.
-->
<template>
  <OCodeBlock
    :code="query"
    :lang="language"
    wrap
    padded
    class="my-0!"
    data-test="alert-query-preview"
  />
</template>

<script setup lang="ts">
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";

withDefaults(defineProps<{ query?: string; language?: string }>(), {
  query: "",
  language: "sql",
});
</script>
