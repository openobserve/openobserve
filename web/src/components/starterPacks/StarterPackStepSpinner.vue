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

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
</script>

<template>
  <!-- OSpinner paints its own colour; the step circle needs one that follows the indicator text. -->
  <OIcon
    name="progress-activity"
    size="sm"
    class="animate-spin"
    data-test="starter-pack-step-spinner"
  />
</template>
