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
// A folder's icon in a fixed-width slot. The box is always the same size
// whether or not the folder has an icon, so names line up in a list, and a
// folder without one still reads as a folder rather than as a gap.
//
// Shared by the folder rail and the folder dropdowns so the two can't drift.

import OGlyph from "@/lib/forms/EmojiPicker/OGlyph.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconToken } from "@/lib/forms/EmojiPicker/OGlyph.types";

withDefaults(
  defineProps<{
    /** The folder's chosen icon, or null to fall back to the folder glyph. */
    token?: IconToken | null;
    /** Renders the favourites star instead of the folder fallback. */
    favorite?: boolean;
  }>(),
  { token: null, favorite: false },
);
</script>

<template>
  <span class="flex size-4 shrink-0 items-center justify-center" data-test="folder-icon">
    <OGlyph v-if="token" :token="token" size="sm" />
    <OIcon v-else-if="favorite" name="star" size="sm" class="text-favorite" />
    <OIcon v-else name="folder-outline" size="sm" class="text-current" />
  </span>
</template>
