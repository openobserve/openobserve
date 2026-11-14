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
import { computed, provide, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { BUTTON_GROUP_SIZE, type ButtonSize } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { NOTICE_TONE_CLASS, NOTICE_TONE_ICON, noticeRole } from "./noticeTone";
import type {
  InlineNoticeEmits,
  InlineNoticeProps,
  InlineNoticeSlots,
} from "./OInlineNotice.types";

const props = withDefaults(defineProps<InlineNoticeProps>(), {
  tone: "info",
  message: undefined,
  icon: undefined,
  actionLabel: undefined,
  actionVariant: "secondary",
  actionDataTest: undefined,
});

const emit = defineEmits<InlineNoticeEmits>();
const slots = defineSlots<InlineNoticeSlots>();

// One small action keeps the notice's rhythm; a 32-high button would stretch a one-line notice.
provide(BUTTON_GROUP_SIZE, ref<ButtonSize>("sm"));

const glyph = computed(() => props.icon ?? NOTICE_TONE_ICON[props.tone]);
</script>

<template>
  <div
    :role="noticeRole(tone)"
    :data-tone="tone"
    :class="[
      'rounded-default text-compact flex gap-2 border px-3 py-2 leading-5',
      NOTICE_TONE_CLASS[tone],
    ]"
  >
    <!-- Top-aligned with the first line of text, which may wrap. -->
    <OIcon :name="glyph" size="sm" class="mt-0.5 shrink-0" aria-hidden="true" />
    <!-- The base `p` rule sets its own colour, which would beat the tone's text colour. -->
    <div class="min-w-0 flex-1 [&_p]:text-inherit" data-test="o-inline-notice-message">
      <slot>{{ message }}</slot>
    </div>
    <div v-if="slots.actions || actionLabel" class="ms-auto flex shrink-0 items-center self-center">
      <slot name="actions">
        <OButton
          :variant="actionVariant"
          :data-test="actionDataTest ?? 'o-inline-notice-action'"
          @click="emit('action', $event)"
        >
          {{ actionLabel }}
        </OButton>
      </slot>
    </div>
  </div>
</template>
