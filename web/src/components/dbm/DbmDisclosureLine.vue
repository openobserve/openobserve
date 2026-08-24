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
  DbmDisclosureLine — a caveat about the numbers, stated in the reading path.

  `items-start` rather than `items-center`, and the icon nudged down a hair:
  these lines WRAP, and a centred glyph on a two-line caveat floats into the gap
  between the lines instead of marking where the sentence begins.

  Never a tooltip. A reader who does not see the caveat reads a lifetime counter
  as a per-window one — which is a wrong number, not a missing nicety — so it
  costs the page a row and stays visible.
-->
<template>
  <div class="text-text-secondary text-2xs flex items-start gap-1.5" :data-test="dataTest">
    <OIcon :name="icon" class="mt-px shrink-0" size="xs" />
    <span><slot /></span>
  </div>
</template>

<script setup lang="ts">
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OIcon from "@/lib/core/Icon/OIcon.vue";

withDefaults(
  defineProps<{
    /** `info` for a caveat, `check` for an all-clear — the only two in use. */
    icon?: IconName;
    dataTest?: string;
  }>(),
  { icon: "info", dataTest: undefined },
);
</script>
