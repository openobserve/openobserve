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
  <OButton
    :disabled-reason="
      isWebUrlNotConfigured || (disabled && !!tooltip)
        ? isWebUrlNotConfigured
          ? t('search.webUrlNotConfigured')
          : tooltip
        : undefined
    "
    ref="buttonRef"
    :data-test="dataTest"
    :aria-label="t('search.shareLink')"
    :class="buttonClass"
    :variant="variant"
    :size="size"
    :icon-only="!showLabel"
    :loading="isLoading"
    :disabled="disabled || !url || isWebUrlNotConfigured"
    @click="handleShareClick"
    icon="share"
  >
    <span v-if="showLabel">{{ t("search.shareLink") }}</span>
    <OTooltip
      v-if="!isWebUrlNotConfigured && !(disabled && tooltip) && (tooltip || !showLabel)"
      :content="tooltip || t('search.shareLink')"
      :keys="shortcut || undefined"
      :shortcut="shortcutId || undefined"
    />
  </OButton>
</template>

<script lang="ts">
import { defineComponent, ref, type PropType } from "vue";
import { raw, type I18nText, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant, ButtonSize } from "@/lib/core/Button/OButton.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShareLink } from "@/composables/useShareLink";

export default defineComponent({
  name: "ShareButton",
  components: { OButton, OTooltip },
  props: {
    // The long URL to be copied and shortened
    url: {
      type: String,
      required: true,
    },
    // Custom CSS classes for the button (legacy — for non-dashboard callers)
    buttonClass: {
      type: String,
      default: "",
    },
    // Unset lets OButton choose: ghost when icon-only, secondary with the label.
    variant: {
      type: String as PropType<ButtonVariant>,
      default: undefined,
    },
    // OButton size
    size: {
      type: String as PropType<ButtonSize>,
      default: "md",
    },
    // Show "Share" label text next to icon
    showLabel: {
      type: Boolean,
      default: false,
    },
    // Custom tooltip text
    tooltip: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
    // Optional keyboard-shortcut hint shown in the tooltip (raw key, e.g. "ctrl+shift+c")
    shortcut: {
      type: String,
      default: "",
    },
    // Registry shortcut id — resolves the hint key from shortcutRegistry.ts so a
    // key change there updates this tooltip too. Prefer this over `shortcut`.
    shortcutId: {
      type: String,
      default: "",
    },
    // Disable the button
    disabled: {
      type: Boolean,
      default: false,
    },
    // Data test attribute for testing
    dataTest: {
      type: String,
      default: "share-link-btn",
    },
  },
  emits: ["copy:success", "copy:error", "shorten:success", "shorten:error"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const buttonRef = ref<{ $el: HTMLElement } | null>(null);

    // Also the entry point for copy-URL keyboard shortcuts, which call it through a template ref.
    const {
      isLoading,
      isWebUrlNotConfigured,
      share: handleShareClick,
    } = useShareLink({
      url: () => props.url,
      disabled: () => props.disabled,
      anchor: () => buttonRef.value?.$el,
      events: {
        copySuccess: (payload) => emit("copy:success", payload),
        copyError: (payload) => emit("copy:error", payload),
        shortenSuccess: (payload) => emit("shorten:success", payload),
        shortenError: (payload) => emit("shorten:error", payload),
      },
    });

    return {
      raw,
      t,
      isLoading,
      buttonRef,
      isWebUrlNotConfigured,
      handleShareClick,
    };
  },
});
</script>
