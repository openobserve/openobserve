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
    ref="root"
    data-test="edit-role-summary"
    class="@container/role-overview flex min-h-0 min-w-0 flex-1 flex-col"
  >
    <OPageHeader
      :title="t('iam.editRole.moduleOverviewTitle')"
      title-data-test="edit-role-summary-title"
      icon="assignment"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </OPageHeader>

    <!-- Stacks when the rails squeeze the overview, which a viewport breakpoint cannot see. -->
    <div class="relative flex min-h-0 flex-1 @max-[38rem]/role-overview:flex-col">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div v-if="loading" class="flex flex-1 items-center justify-center p-6">
          <OSpinner size="md" data-test="edit-role-summary-loading" />
        </div>

        <div v-else-if="!modules.length" class="flex flex-1 items-center justify-center p-6">
          <OEmptyState
            size="hero"
            preset="no-data"
            :title="t('iam.editRole.summaryEmptyTitle')"
            :description="t('iam.editRole.summaryEmptyDescription')"
            data-test="edit-role-summary-empty"
          />
        </div>

        <OContent v-else class="flex flex-col gap-3 py-4">
          <!-- Fixed-width columns keep cards still when the Presets panel opens or closes; the end gutter keeps the top card clear of the floating Show Presets button. -->
          <div
            class="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),17rem))] gap-3"
            :class="{ 'pe-10': !presetsOpen }"
          >
            <button
              v-for="module in modules"
              :key="module.moduleKey"
              type="button"
              class="group rounded-surface border-border-default bg-surface-panel hover:border-accent focus-visible:ring-accent flex h-full flex-col border p-3 text-left shadow-xs transition outline-none hover:shadow-md focus-visible:ring-2"
              :data-test="`edit-role-summary-module-${module.moduleKey}`"
              @click="emit('open', module.moduleKey)"
            >
              <span class="flex w-full items-start gap-2.5">
                <span
                  class="rounded-default inline-flex size-8 shrink-0 items-center justify-center"
                  :class="groupTone(module.group)"
                  :data-test="`edit-role-summary-icon-${module.moduleKey}`"
                >
                  <OIcon :name="module.icon" size="sm" />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <OTruncatedText
                      class="text-text-heading group-hover:text-accent text-sm font-semibold transition-colors"
                    >
                      {{ module.label }}
                    </OTruncatedText>
                    <span
                      v-if="module.added || module.removed"
                      class="bg-accent size-1.5 shrink-0 rounded-full"
                      :data-test="`edit-role-summary-unsaved-${module.moduleKey}`"
                    >
                      <span class="sr-only">{{ t("iam.editRole.summaryPendingTitle") }}</span>
                    </span>
                  </span>
                  <OTruncatedText class="text-text-secondary mt-0.5 text-xs leading-snug">
                    {{ module.description }}
                  </OTruncatedText>
                </span>
                <OIcon
                  name="chevron-right"
                  size="sm"
                  class="text-text-secondary group-hover:text-accent mt-1 shrink-0 transition group-hover:translate-x-0.5"
                />
              </span>

              <span class="mt-auto w-full pt-3">
                <span
                  class="border-border-default flex items-center justify-between gap-2 border-t pt-2"
                >
                  <span class="flex items-baseline gap-1">
                    <span
                      class="text-text-heading text-sm font-semibold tabular-nums"
                      :data-test="`edit-role-summary-granted-${module.moduleKey}`"
                    >
                      {{ grouped(module.granted) }}
                    </span>
                    <span class="text-text-secondary text-xs">
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

      <OButton
        v-if="!presetsOpen"
        variant="outline"
        size="icon-sm"
        class="absolute end-3 top-3 z-10"
        :aria-label="t('iam.editRole.presetsShow')"
        data-test="edit-role-presets-open"
        @click="setPresetsOpen(true)"
      >
        <OIcon name="library-add" size="sm" />
        <OTooltip :content="t('iam.editRole.presetsShow')" side="left" />
      </OButton>

      <RolePresetsPanel
        v-else
        class="border-border-default w-85 shrink-0 border-s @max-[38rem]/role-overview:max-h-[55%] @max-[38rem]/role-overview:w-auto @max-[38rem]/role-overview:border-s-0 @max-[38rem]/role-overview:border-t"
        :presets="presets"
        :preview-preset="previewPreset"
        :loading="loading"
        :applying="applying"
        :module-label="moduleLabel"
        :entity-label="entityLabel"
        :summary-actions="summaryActions"
        @apply="(presetId) => emit('preset', presetId)"
        @load-streams="emit('load-streams')"
        @close="setPresetsOpen(false)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import RolePresetsPanel from "@/components/iam/roles/RolePresetsPanel.vue";
import { groupTone } from "@/components/iam/roles/roleGroupTone";
import type { PresetInfo, PresetPreview } from "@/composables/iam/useRolePresets";

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
  /** Staged changes, as the rail counts them; either one shows the unsaved dot. */
  added?: number;
  removed?: number;
};

defineProps<{
  modules: SummaryModule[];
  loading: boolean;
  presets: PresetInfo[];
  previewPreset: (id: string) => PresetPreview;
  applying: boolean;
  moduleLabel: (key: string) => I18nText;
  entityLabel: (resource: string, entity: string) => I18nText;
  summaryActions: (actions: string[]) => SummaryAction[];
}>();

const emit = defineEmits<{
  open: [moduleKey: string];
  preset: [presetId: string];
  "load-streams": [];
}>();

const { t } = useI18nTyped();

const grouped = (count: number) => raw(count.toLocaleString());

const root = ref<HTMLElement | null>(null);
// The page holds this so a closed panel survives this component remounting, but not the next visit.
const presetsOpen = defineModel<boolean>("presetsOpen", { default: true });

// Focus follows the toggle so a keyboard user is not dropped to the page when the clicked button unmounts.
const setPresetsOpen = (open: boolean) => {
  presetsOpen.value = open;
  const target = open ? "edit-role-presets-close" : "edit-role-presets-open";
  nextTick(() => root.value?.querySelector<HTMLElement>(`[data-test="${target}"]`)?.focus());
};
</script>
