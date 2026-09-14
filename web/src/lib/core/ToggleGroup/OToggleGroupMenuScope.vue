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
import { provide } from "vue";
import type { AcceptableValue } from "reka-ui";
import { ToggleGroupMenuKey } from "./OToggleGroup.types";

const props = defineProps<{
  mode: "trigger" | "menu";
  isActive: (value: AcceptableValue | boolean) => boolean;
  select: (value: AcceptableValue | boolean) => void;
}>();

// Items read this through inject, so the same group slot renders as a trigger label or as menu rows.
provide(ToggleGroupMenuKey, {
  mode: props.mode,
  isActive: (value) => props.isActive(value),
  select: (value) => props.select(value),
});
</script>

<template>
  <slot />
</template>
