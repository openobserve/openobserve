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
  <div data-test="edit-role-summary" class="flex min-h-0 min-w-0 flex-1 flex-col">
    <OPageHeader
      :title="t('iam.editRole.moduleOverviewTitle')"
      title-data-test="edit-role-summary-title"
      icon="assignment"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </OPageHeader>

    <div v-if="loading" class="flex flex-1 items-center justify-center p-6">
      <OSpinner size="md" data-test="edit-role-summary-loading" />
    </div>

    <div v-else-if="!modules.length" class="flex flex-1 items-center justify-center p-6">
      <OEmptyState
        size="hero"
        preset="no-data"
        :title="t('iam.editRole.summaryEmptyTitle')"
        :description="t('iam.editRole.summaryEmptyDescription')"
        :actions="presetActions"
        data-test="edit-role-summary-empty"
        @action="(id: unknown) => emit('preset', String(id))"
      />
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <OContent class="flex flex-col gap-3 py-4">
        <div class="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="module in modules"
            :key="module.moduleKey"
            type="button"
            class="group rounded-surface border-border-default bg-surface-panel hover:border-accent focus-visible:ring-accent flex h-full flex-col border p-4 text-left shadow-xs transition outline-none hover:shadow-md focus-visible:ring-2"
            :data-test="`edit-role-summary-module-${module.moduleKey}`"
            @click="emit('open', module.moduleKey)"
          >
            <span class="flex w-full items-start gap-3">
              <span
                class="rounded-default inline-flex size-10 shrink-0 items-center justify-center"
                :class="GROUP_TONE[module.group] ?? NEUTRAL_TONE"
                :data-test="`edit-role-summary-icon-${module.moduleKey}`"
              >
                <OIcon :name="module.icon" size="md" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span
                  class="text-text-heading group-hover:text-accent truncate text-sm font-semibold transition-colors"
                >
                  {{ module.label }}
                </span>
                <span class="text-text-secondary mt-0.5 line-clamp-2 text-xs leading-snug">
                  {{ module.description }}
                </span>
              </span>
              <OIcon
                name="chevron-right"
                size="sm"
                class="text-text-secondary group-hover:text-accent mt-1 shrink-0 transition group-hover:translate-x-0.5"
              />
            </span>

            <span class="mt-auto w-full pt-4">
              <span
                class="border-border-default flex items-end justify-between gap-2 border-t pt-3"
              >
                <span class="flex flex-col">
                  <span
                    class="text-text-heading text-2xl leading-none font-semibold tabular-nums"
                    :data-test="`edit-role-summary-granted-${module.moduleKey}`"
                  >
                    {{ grouped(module.granted) }}
                  </span>
                  <span class="text-text-secondary mt-1 text-xs">
                    {{ t("iam.editRole.summaryGrantsLabel", {}, module.granted) }}
                  </span>
                </span>
                <span class="flex flex-wrap justify-end gap-1">
                  <OBadge
                    v-for="action in module.actions"
                    :key="action.action"
                    variant="primary-soft"
                    size="sm"
                  >
                    {{ action.label }}
                  </OBadge>
                </span>
              </span>
            </span>
          </button>
        </div>
      </OContent>
    </div>
  </div>
</template>

<script setup lang="ts">
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

export type SummaryAction = { action: string; label: I18nText };

export type SummaryModule = {
  moduleKey: string;
  label: I18nText;
  icon: IconName;
  /** Rail group, which picks the icon tile's colour. */
  group: string;
  granted: number;
  /** One line on how far the module's grants reach. */
  description: I18nText;
  /** Every action granted anywhere in the module. */
  actions: SummaryAction[];
};

defineProps<{
  modules: SummaryModule[];
  loading: boolean;
}>();

const emit = defineEmits<{
  open: [moduleKey: string];
  preset: [presetId: string];
}>();

// Tile colour tells the module's category apart at a glance; every class is a registered token.
const GROUP_TONE: Record<string, string> = {
  data: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  dashboards: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  alerting: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  pipelines: "bg-badge-teal-soft-bg text-badge-teal-soft-text",
  monitoring: "bg-icon-chip-info-bg text-icon-chip-info-text",
  ai: "bg-icon-chip-primary-bg text-icon-chip-primary-text",
  access: "bg-icon-chip-success-bg text-icon-chip-success-text",
};

const NEUTRAL_TONE = "bg-surface-subtle text-text-secondary";

const { t } = useI18nTyped();

const grouped = (count: number) => raw(count.toLocaleString());

const presetActions: EmptyStateAction[] = [
  {
    id: "readonly",
    icon: "visibility",
    titleKey: "iam.editRole.presetReadonlyTitle",
    descriptionKey: "iam.editRole.presetReadonlyDescription",
  },
  {
    id: "dbm",
    icon: "database",
    titleKey: "iam.editRole.presetDbmTitle",
    descriptionKey: "iam.editRole.presetDbmDescription",
  },
  {
    id: "k8s",
    icon: "cloud",
    titleKey: "iam.editRole.presetK8sTitle",
    descriptionKey: "iam.editRole.presetK8sDescription",
  },
];
</script>
