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
  <OButton variant="row" block>
    <!-- the inset gives the hover background room around the text; lists pull it back with -mx-2 so text stays on the card's edge -->
    <span class="flex w-full min-w-0 items-center justify-between gap-3 px-2">
      <slot />
    </span>
  </OButton>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
</script>
