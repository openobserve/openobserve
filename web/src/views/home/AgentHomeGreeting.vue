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
  <div
    class="flex min-w-0 items-center justify-center gap-4 pt-10 pb-2 max-md:pt-6"
    data-test="agent-home-greeting"
  >
    <span class="relative inline-flex shrink-0" data-test="agent-home-greeting-mark">
      <img
        :src="logoSrc"
        :alt="t('aiAssistant.welcome.taglineHighlight')"
        class="relative size-14 max-md:size-10"
        data-test="agent-home-greeting-logo"
      />
    </span>
    <div class="flex min-w-0 flex-col gap-1.5">
      <i18n-t
        v-if="displayName"
        :keypath="namedKey"
        tag="h2"
        :class="HEADING_CLASS"
        data-test="agent-home-greeting-text"
      >
        <template #name>
          <span
            class="bg-gradient-brand-ribbon [background-clip:text] text-transparent [-webkit-background-clip:text]"
            data-test="agent-home-greeting-name"
            >{{ displayName }}</span
          >
        </template>
      </i18n-t>
      <h2 v-else :class="HEADING_CLASS" data-test="agent-home-greeting-text">
        {{ greeting }}
      </h2>
      <div v-if="chips.length" class="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
        <OTag
          v-for="chip in chips"
          :key="chip.id"
          :variant="chip.variant"
          dot
          size="xs"
          :label="chip.label"
          :data-test="`agent-home-greeting-${chip.id}`"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import { useGreeting } from "@/components/ai-assistant/welcome/useGreeting";
import { useTheme } from "@/composables/useTheme";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const HEADING_CLASS = "text-text-heading text-3xl leading-tight font-semibold max-md:text-2xl";

const props = withDefaults(defineProps<{ answersReady?: number }>(), { answersReady: 0 });

const { t } = useI18nTyped();
const vuex = useStore();
const { isDark } = useTheme();
const logoSrc = computed(() =>
  getImageURL(isDark.value ? "images/common/o2_ai_logo_dark.svg" : "images/common/o2_ai_logo.svg"),
);
const { greeting, displayName, period } = useGreeting(() => vuex?.state.userInfo?.email);
// The name sits in the translated sentence as a slot, so the language still decides where it goes.
const namedKey = computed<I18nKey>(() => `aiAssistant.greetingNamed.${period.value}`);

// One chip and no sentence: the answers ready to read (H2).
const chips = computed(() => {
  const list: { id: string; label: I18nText; variant: BadgeVariant }[] = [];
  if (props.answersReady > 0)
    list.push({
      id: "answers",
      label: t("home.answersReady", { count: props.answersReady }, props.answersReady),
      variant: "primary-soft",
    });
  return list;
});
</script>
