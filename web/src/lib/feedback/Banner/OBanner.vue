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
import { computed, provide, ref, useAttrs } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { BUTTON_GROUP_SIZE, type ButtonSize } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { NOTICE_TONE_CLASS, NOTICE_TONE_ICON, noticeRole } from "../InlineNotice/noticeTone";
import { useI18nTyped } from "@/types/i18n";
import type { BannerEmits, BannerProps, BannerSlots } from "./OBanner.types";

const props = withDefaults(defineProps<BannerProps>(), {
  tone: "info",
  message: undefined,
  icon: undefined,
  dismissible: false,
  actionLabel: undefined,
  actionVariant: "secondary",
  actionDataTest: undefined,
});

const emit = defineEmits<BannerEmits>();
const slots = defineSlots<BannerSlots>();

const { t } = useI18nTyped();
const attrs = useAttrs();

// The banner is 36 high, so the one action in it is the 28-high button.
provide(BUTTON_GROUP_SIZE, ref<ButtonSize>("sm"));

const glyph = computed(() => props.icon ?? NOTICE_TONE_ICON[props.tone]);
// Named after the banner so two banners keep distinct hooks; a function, since attrs are not reactive.
const dismissTest = () => {
  const own = attrs["data-test"];
  return typeof own === "string" && own ? `${own}-dismiss` : "o-banner-dismiss";
};
</script>

<template>
  <div
    :role="noticeRole(tone)"
    :data-tone="tone"
    :class="[
      'min-h-control-lg text-compact px-page-edge flex w-full items-center gap-3 border-b py-1.5 leading-5',
      NOTICE_TONE_CLASS[tone],
    ]"
  >
    <OIcon :name="glyph" size="sm" class="shrink-0" aria-hidden="true" />
    <!-- The base `p` rule sets its own colour, which would beat the tone's text colour. -->
    <div class="min-w-0 flex-1 [&_p]:text-inherit" data-test="o-banner-message">
      <slot>{{ message }}</slot>
    </div>
    <div v-if="slots.actions || actionLabel" class="flex shrink-0 items-center">
      <slot name="actions">
        <OButton
          :variant="actionVariant"
          :data-test="actionDataTest ?? 'o-banner-action'"
          @click="emit('action', $event)"
        >
          {{ actionLabel }}
        </OButton>
      </slot>
    </div>
    <OButton
      v-if="dismissible"
      variant="ghost"
      size="xs"
      icon="close"
      icon-only
      class="shrink-0"
      :label="t('common.dismiss')"
      :data-test="dismissTest()"
      @click="emit('dismiss')"
    />
  </div>
</template>
