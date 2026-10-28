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
<template>
  <OButton variant="ghost" block class="h-auto! justify-between! gap-3! px-0! py-1.5! text-start">
    <slot />
  </OButton>
</template>

<script setup lang="ts">
// OButton centers its content; rows need start and end alignment with no inset
import OButton from "@/lib/core/Button/OButton.vue";
</script>
