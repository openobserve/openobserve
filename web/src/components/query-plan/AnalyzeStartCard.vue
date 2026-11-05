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
    class="bg-surface-base border-border-default rounded-surface flex w-full max-w-140 flex-col gap-3.5 border p-6 shadow-sm max-md:p-4"
    data-test="query-plan-analyze-start"
  >
    <OBanner
      v-if="notice"
      :variant="notice.variant"
      :icon="notice.variant === 'error' ? 'error-outline' : 'info-outline'"
      :content="notice.text"
      dense
      preserve-whitespace
      data-test="query-plan-analyze-notice"
    />
    <h3 class="text-text-heading m-0 flex items-center gap-2.5 text-lg font-semibold">
      <OIcon name="speed" size="sm" class="text-accent" />
      {{ command }}
    </h3>
    <p class="text-text-secondary m-0 text-sm leading-relaxed">
      {{ t("search.queryProfile.analyzeIntro") }}
    </p>
    <div class="grid grid-cols-2 gap-1.5 max-md:grid-cols-1">
      <ProfileStatTile
        v-for="f in facts"
        :key="f.key"
        :label="f.label"
        :value="f.value"
        :sub="f.sub"
        :data-test="`query-plan-analyze-fact-${f.key}`"
      />
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <OButton
        variant="primary"
        size="sm"
        icon-left="play-arrow"
        data-test="query-plan-analyze-run"
        @click="emit('run')"
        >{{
          retry
            ? t("search.queryProfile.tryAgain")
            : t("search.queryProfile.runCommand", { command })
        }}</OButton
      >
      <span class="text-text-secondary text-xs">{{ t("search.queryProfile.cancelHint") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ProfileStatTile from "./ProfileStatTile.vue";
import type { AnalyzeFact, AnalyzeNotice } from "./profileStyles";

defineProps<{
  facts: AnalyzeFact[];
  notice: AnalyzeNotice | null;
  retry: boolean;
}>();

const emit = defineEmits<{ run: [] }>();

const { t } = useI18nTyped();

const command = raw("EXPLAIN ANALYZE");
</script>
