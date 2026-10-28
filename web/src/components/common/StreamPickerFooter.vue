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
import { computed, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import { useHideInternalStreams } from "@/composables/useHideInternalStreams";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** `footer` goes in OSelect's `#after-options` slot, `empty` in its `#empty` slot. */
    variant?: "footer" | "empty";
    hiddenCount?: number;
    searchMatchCount?: number;
    /** Every stream is internal and hidden; the empty state already states the count. */
    onlyInternalHidden?: boolean;
    dataTest?: string;
  }>(),
  {
    variant: "footer",
    hiddenCount: 0,
    searchMatchCount: 0,
    onlyInternalHidden: false,
    dataTest: "stream-picker",
  },
);

const { t } = useI18nTyped();
const { hideInternalStreams, showInternalStreams } = useHideInternalStreams();

const countId = `stream-picker-count-${useId()}`;
const announcement = ref<I18nText | "">("");

const countMode = computed<"search" | "hidden" | null>(() => {
  if (props.searchMatchCount > 0) return "search";
  if (props.hiddenCount > 0 && !props.onlyInternalHidden) return "hidden";
  return null;
});

const announce = (hidden: boolean) => {
  announcement.value = hidden
    ? t("components.streamPicker.announceHidden")
    : t("components.streamPicker.announceShown");
};

const onToggle = (value: SwitchValue) => {
  hideInternalStreams.value = value === true;
  announce(value === true);
};

const onShow = () => {
  showInternalStreams();
  announce(false);
};
</script>

<template>
  <div
    v-if="variant === 'empty'"
    :data-test="`${dataTest}-all-internal-hidden`"
    class="flex items-center justify-between gap-3"
  >
    <span class="text-text-secondary">{{
      t("components.streamPicker.allInternalHidden", { count: hiddenCount }, hiddenCount)
    }}</span>
    <OButton
      variant="ghost-primary"
      size="xs"
      :aria-label="t('components.streamPicker.showInternal')"
      :data-test="`${dataTest}-empty-show-btn`"
      @click="onShow"
    >
      {{ t("components.streamPicker.show") }}
    </OButton>
  </div>
  <div
    v-else
    :data-test="`${dataTest}-footer`"
    class="border-border-default flex shrink-0 flex-col gap-2 border-t px-3 py-2"
  >
    <div class="flex items-center justify-between gap-3">
      <OSwitch
        :model-value="hideInternalStreams"
        size="lg"
        :label="t('components.streamPicker.hideInternal')"
        :aria-describedby="countMode ? countId : undefined"
        :data-test="`${dataTest}-hide-internal-switch`"
        @update:model-value="onToggle"
      />
      <span
        v-if="countMode === 'hidden'"
        :id="countId"
        :data-test="`${dataTest}-hidden-count`"
        class="text-text-secondary text-xs whitespace-nowrap"
      >
        {{ t("components.streamPicker.hiddenCount", { count: hiddenCount }, hiddenCount) }}
      </span>
    </div>
    <div v-if="countMode === 'search'" class="flex items-center justify-between gap-3">
      <span
        :id="countId"
        :data-test="`${dataTest}-search-match-count`"
        class="text-text-secondary text-xs"
      >
        {{
          t(
            "components.streamPicker.searchMatchCount",
            { count: searchMatchCount },
            searchMatchCount,
          )
        }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :aria-label="t('components.streamPicker.showInternal')"
        :data-test="`${dataTest}-show-btn`"
        @click="onShow"
      >
        {{ t("components.streamPicker.show") }}
      </OButton>
    </div>
    <span aria-live="polite" :data-test="`${dataTest}-announcement`" class="sr-only">{{
      announcement
    }}</span>
  </div>
</template>
