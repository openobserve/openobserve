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

<!-- A hint that lives in a tooltip: a Tab stop that opens it on focus, so keyboard and screen-reader users reach the text too. -->
<template>
  <OTooltip :content="hint" :max-width="maxWidth">
    <span
      v-bind="$attrs"
      tabindex="0"
      :role="$slots.default ? undefined : 'img'"
      :aria-label="$slots.default ? undefined : hint"
      class="rounded-default focus-visible:ring-badge-focus-ring inline-flex shrink-0 items-center outline-none focus-visible:ring-2"
    >
      <slot>
        <OIcon :name="icon" size="sm" :class="iconClass" />
      </slot>
    </span>
    <template v-if="$slots.content" #content>
      <slot name="content" />
    </template>
  </OTooltip>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

// The data-test and classes belong on the focusable trigger, not on the tooltip's portalled bubble.
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** The full hint; also the icon's accessible name when no trigger is slotted. */
    hint: I18nText;
    icon?: IconName;
    iconClass?: string;
    maxWidth?: string;
  }>(),
  { icon: "info", iconClass: "text-text-secondary", maxWidth: undefined },
);
</script>
