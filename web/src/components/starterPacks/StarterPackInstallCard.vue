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
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

const props = defineProps<{
  flow: StarterPackFlow;
  title: I18nText;
  streamCount: number;
  testId: string;
  primaryLabel?: I18nText;
  primaryTestId?: string;
  dismissible?: boolean;
}>();
const emit = defineEmits<{ install: []; details: []; dismiss: [] }>();

const { t } = useI18nTyped();

const dashboards = computed(() => props.flow.dashboardCount.value);
const alerts = computed(() => props.flow.alertCount.value);
const views = computed(() => props.flow.viewCount.value);
const total = computed(() => dashboards.value + alerts.value + views.value);
</script>

<template>
  <div
    class="border-border-default rounded-default bg-surface-subtle flex items-start gap-3 border p-3 text-sm"
    :data-test="testId"
  >
    <OIcon name="hub" size="md" class="text-text-secondary mt-0.5 shrink-0" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <strong class="text-base">{{ t("starterPacks.home.title", { title }) }}</strong>
      <div class="flex flex-wrap items-center gap-3" :data-test="`${testId}-counts`">
        <span>{{ t("starterPacks.card.dashboards", { count: dashboards }, dashboards) }}</span>
        <span>{{ t("starterPacks.countAlerts", { count: alerts }, alerts) }}</span>
        <span>{{ t("starterPacks.card.savedSearches", { count: views }, views) }}</span>
      </div>
      <OText variant="meta" :data-test="`${testId}-sub`"
        >{{
          streamCount ? t("starterPacks.card.matched", { count: streamCount }, streamCount) : ""
        }}
        {{ t("starterPacks.card.removable") }}</OText
      >
      <OText v-if="flow.preview.value?.offline" variant="meta" :data-test="`${testId}-offline`">{{
        t("starterPacks.offline")
      }}</OText>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <OButton
        variant="primary"
        size="sm-action"
        :data-test="primaryTestId ?? `${testId}-setup-btn`"
        @click="emit('install')"
      >
        {{ primaryLabel ?? t("starterPacks.card.install", { count: total }, total) }}
      </OButton>
      <OButton
        variant="ghost-primary"
        size="sm-action"
        :data-test="`${testId}-details-btn`"
        @click="emit('details')"
      >
        {{ t("starterPacks.card.seeIncluded") }}
      </OButton>
      <slot name="actions" />
      <OButton
        v-if="dismissible"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('starterPacks.card.close')"
        :data-test="`${testId}-dismiss-btn`"
        @click="emit('dismiss')"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>
  </div>
</template>
