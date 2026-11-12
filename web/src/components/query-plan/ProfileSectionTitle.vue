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
  <h4 class="text-text-secondary m-0 text-xs font-semibold" :class="SPACING[spacing]">
    {{ title }}
  </h4>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    title: I18nText;
    /** Room below the title: none when it shares a row with controls. */
    spacing?: "none" | "tight" | "normal";
  }>(),
  { spacing: "normal" },
);

const SPACING = { none: "", tight: "mb-1", normal: "mb-2" } as const;
</script>
