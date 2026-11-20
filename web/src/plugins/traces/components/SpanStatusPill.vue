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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <!-- Only ERROR earns a chip; a box on every OK/UNSET row is noise. -->
  <OTag
    v-if="status?.toUpperCase() === 'ERROR'"
    data-test="span-row-status-pill"
    type="spanStatus"
    value="error"
    :label="raw('ERROR')"
    class="uppercase"
  />
  <span
    v-else
    data-test="span-row-status-pill"
    class="text-text-secondary text-compact uppercase"
    >{{ status || "UNSET" }}</span
  >
</template>

<script setup lang="ts">
import { raw } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";

defineProps<{
  status?: string;
}>();
</script>
