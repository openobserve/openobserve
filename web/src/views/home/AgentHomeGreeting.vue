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
  <div class="flex min-w-0 items-center gap-3" data-test="agent-home-greeting">
    <AssistantMark size="md" />
    <div class="flex min-w-0 flex-col gap-1">
      <h2 class="text-text-heading text-xl font-semibold" data-test="agent-home-greeting-text">
        {{ greeting }}
      </h2>
      <div v-if="chips.length" class="flex min-w-0 flex-wrap items-center gap-1.5">
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

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { useGreeting } from "@/components/ai-assistant/welcome/useGreeting";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(defineProps<{ answersReady?: number; needYou?: number }>(), {
  answersReady: 0,
  needYou: 0,
});

const { t } = useI18nTyped();
const vuex = useStore();
const { greeting } = useGreeting(() => vuex?.state.userInfo?.email);

// At most two chips and no sentence: what is ready, and what waits on the reader (H2).
const chips = computed(() => {
  const list: { id: string; label: I18nText; variant: BadgeVariant }[] = [];
  if (props.answersReady > 0)
    list.push({
      id: "answers",
      label: t("home.answersReady", { count: props.answersReady }, props.answersReady),
      variant: "primary-soft",
    });
  if (props.needYou > 0)
    list.push({
      id: "need-you",
      label: t("home.needYou", { count: props.needYou }, props.needYou),
      variant: "warning-soft",
    });
  return list;
});
</script>
