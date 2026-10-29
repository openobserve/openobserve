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

<!-- Only for controls that navigate: anything inside stays usable on a license-locked page. -->
<template>
  <component :is="as" v-bind="{ [LOCK_EXEMPT_ATTR]: '' }">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { LOCK_EXEMPT_ATTR, provideFeatureLockExempt } from "@/composables/useFeatureLock";

withDefaults(defineProps<{ as?: string }>(), { as: "div" });

provideFeatureLockExempt();
</script>
