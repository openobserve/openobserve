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
  <span
    class="flex max-w-80 min-w-0 items-center gap-1 text-xs"
    :class="TONE_TEXT[tone]"
    :data-test="dataTest"
  >
    <OIcon :name="icon ?? TONE_ICON[tone]" size="sm" class="shrink-0" />
    <span v-if="!compact" class="min-w-0 truncate max-xl:hidden" :data-test="`${dataTest}-text`">
      {{ text }}
    </span>
    <OTooltip side="bottom" :content="detail ?? text" />
  </span>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

export type DbmToolbarNoteTone = "neutral" | "warning" | "error";

const TONE_TEXT: Record<DbmToolbarNoteTone, string> = {
  neutral: "text-text-secondary",
  warning: "text-status-warning-text",
  error: "text-status-error-text",
};

const TONE_ICON: Record<DbmToolbarNoteTone, IconName> = {
  neutral: "info-outline",
  warning: "warning-amber",
  error: "error-outline",
};

withDefaults(
  defineProps<{
    /** The short form, always one line; hidden below xl so it never starves the filter chips beside it. */
    text: I18nText;
    detail?: I18nText;
    tone?: DbmToolbarNoteTone;
    icon?: IconName;
    /** Icon only at every width, for a toolbar with no room left for text. */
    compact?: boolean;
    dataTest?: string;
  }>(),
  {
    detail: undefined,
    tone: "neutral",
    icon: undefined,
    compact: false,
    dataTest: "dbm-toolbar-note",
  },
);
</script>
