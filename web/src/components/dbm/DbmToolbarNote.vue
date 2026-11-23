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
  <!-- Icon only: the caveat is read once, then the label would only take toolbar room. -->
  <button
    type="button"
    class="rounded-default hover:bg-surface-subtle flex size-7 shrink-0 items-center justify-center"
    :class="TONE_TEXT[tone]"
    :aria-label="text"
    :data-test="dataTest"
  >
    <OTooltip side="bottom" :content="detail ?? text" />
    <OIcon :name="icon ?? TONE_ICON[tone]" size="sm" />
  </button>
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
    /** The short form: the button's accessible name, and the tooltip when there is no detail. */
    text: I18nText;
    detail?: I18nText;
    tone?: DbmToolbarNoteTone;
    icon?: IconName;
    dataTest?: string;
  }>(),
  {
    detail: undefined,
    tone: "neutral",
    icon: undefined,
    dataTest: "dbm-toolbar-note",
  },
);
</script>
