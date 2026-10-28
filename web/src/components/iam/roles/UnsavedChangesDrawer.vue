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
  <ODrawer
    data-test="edit-role-unsaved-drawer"
    size="lg"
    bleed
    :open="open"
    :title="t('iam.editRole.summaryPendingTitle')"
    :sub-title="t('iam.editRole.summaryPendingHint')"
    :secondary-button-label="t('iam.editRole.undoAllChanges')"
    :secondary-button-disabled="!changeCount || saving"
    :primary-button-label="t('alerts.save')"
    primary-button-data-test="edit-role-unsaved-save"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('undo', allKeys)"
    @click:primary="emit('save')"
  >
    <section
      v-if="gapRows.length"
      :aria-label="calloutTitle"
      data-test="edit-role-companions"
      class="rounded-default border-badge-warning-soft-text/55 bg-badge-warning-soft-bg mx-4 mt-3 mb-1 border border-dashed"
    >
      <div class="flex items-start gap-2 pe-3">
        <div
          class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 ps-3 pt-2.5 pb-2"
          @click="toggleCallout"
        >
          <OIcon name="warning" size="sm" class="text-badge-warning-soft-text mt-0.5 shrink-0" />
          <span class="min-w-0 flex-1">
            <span class="text-text-heading text-compact block font-semibold">
              {{ calloutTitle }}
            </span>
            <span class="text-text-secondary block text-xs">
              {{ t("iam.editRole.notAddedYetHint") }}
            </span>
            <span
              v-if="!calloutOpen"
              class="text-text-heading mt-1 block text-xs font-medium"
              data-test="edit-role-companions-names"
            >
              {{ namesLine }}
            </span>
          </span>
          <OButton
            variant="ghost"
            size="icon-xs"
            :aria-expanded="calloutOpen"
            aria-controls="edit-role-companions-list"
            :aria-label="calloutTitle"
            data-test="edit-role-companions-toggle"
            @click.stop="toggleCallout"
          >
            <OIcon :name="calloutOpen ? 'expand-less' : 'expand-more'" size="sm" />
          </OButton>
        </div>
        <OButton
          v-if="gapRows.length > 1"
          variant="ghost"
          size="sm"
          icon-left="add"
          class="mt-2 shrink-0"
          :disabled="saving"
          data-test="edit-role-companions-add-all"
          @click="
            emit(
              'add',
              gapRows.flatMap((gap) => gap.keys),
            )
          "
        >
          {{ t("iam.editRole.companionAddAll") }}
        </OButton>
      </div>
      <ul
        v-if="calloutOpen"
        id="edit-role-companions-list"
        class="border-badge-warning-soft-text/20 divide-badge-warning-soft-text/20 max-h-54 divide-y overflow-y-auto border-t ps-9.5 pe-3 pb-0.5"
      >
        <li
          v-for="gap in gapRows"
          :key="gap.module"
          class="flex items-center gap-3 py-2"
          :data-test="`edit-role-companion-${gap.module}`"
        >
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <OTruncatedText class="text-text-body text-sm">{{ gap.label }}</OTruncatedText>
            <span v-for="why in gap.why" :key="why" class="text-text-secondary text-xs">
              {{ why }}
            </span>
          </div>
          <OTooltip v-if="gap.opensModule" :content="t('iam.editRole.companionOpenStreamsTooltip')">
            <OButton
              variant="outline"
              size="sm"
              :disabled="saving"
              :data-test="`edit-role-companion-open-${gap.module}`"
              @click="emit('open-module', gap.module)"
            >
              {{ t("iam.editRole.companionOpenStreams") }}
            </OButton>
          </OTooltip>
          <OButton
            v-else
            variant="outline"
            size="sm"
            icon-left="add"
            :aria-label="t('iam.editRole.companionAddItem', { item: gap.label })"
            :disabled="saving"
            :data-test="`edit-role-companion-add-${gap.module}`"
            @click="emit('add', gap.keys)"
          >
            {{ t("iam.editRole.companionAdd") }}
          </OButton>
        </li>
      </ul>
    </section>
    <div
      class="text-text-secondary flex items-baseline gap-1.5 px-4 pt-4 pb-0.5 text-xs font-semibold"
    >
      {{ t("iam.editRole.yourChanges") }}
      <span class="font-normal" data-test="edit-role-unsaved-summary">
        <span aria-hidden="true">{{ raw("·") }}</span>
        {{ changesLine }}
      </span>
    </div>
    <section
      v-for="group in groups"
      :key="group.key"
      :data-test="`edit-role-unsaved-group-${group.key}`"
    >
      <div
        class="text-text-heading text-compact flex items-center gap-1.5 px-4 pt-2.5 font-semibold"
      >
        <OIcon :name="group.icon" size="sm" class="text-text-secondary" />
        {{ group.label }}
      </div>
      <div
        v-for="change in group.changes"
        :key="change.id"
        class="flex items-start gap-2.5 px-4 pt-1.5 pb-2"
        :data-test="`edit-role-unsaved-${change.id}`"
      >
        <OIcon
          :name="change.state === 'added' ? 'add-circle' : 'do-not-disturb-on'"
          size="sm"
          class="mt-0.5"
          :class="
            change.state === 'added' ? 'text-badge-success-soft-text' : 'text-badge-error-soft-text'
          "
          :label="
            change.state === 'added'
              ? t('iam.editRole.summaryChangeAdded')
              : t('iam.editRole.summaryChangeRemoved')
          "
        />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <OTruncatedText
              class="text-sm"
              :class="
                change.state === 'added' ? 'text-text-body' : 'text-text-secondary line-through'
              "
            >
              {{ change.label }}
            </OTruncatedText>
            <OBadge
              v-for="action in change.actions"
              :key="action.action"
              :variant="change.state === 'added' ? 'primary-soft' : 'default-soft'"
              size="sm"
            >
              {{ action.label }}
            </OBadge>
          </div>
          <p class="text-compact text-text-secondary">{{ change.effect }}</p>
          <p v-for="note in change.notes" :key="note" class="text-text-secondary text-xs">
            {{ note }}
          </p>
        </div>
        <OButton
          variant="ghost"
          size="sm"
          icon-left="undo"
          :disabled="saving"
          :data-test="`edit-role-unsaved-undo-${change.id}`"
          @click="emit('undo', change.keys)"
        >
          {{ t("iam.editRole.summaryUndoRemove") }}
        </OButton>
      </div>
    </section>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { companionAddKeys, type CompanionGap } from "@/components/iam/roles/roleCompanions";

export type PendingChange = {
  id: string;
  state: "added" | "removed";
  label: I18nText;
  moduleLabel: I18nText;
  /** Rail module the change is listed under; resources in no module share one "Other" group. */
  moduleKey: string;
  actions: { action: string; label: I18nText }[];
  keys: string[];
  /** What the change lets the role do, or no longer do, in one sentence. */
  effect: I18nText;
  notes: I18nText[];
};

export type PendingGroup = {
  key: string;
  label: I18nText;
  icon: IconName;
  changes: PendingChange[];
};

const props = defineProps<{
  open: boolean;
  groups: PendingGroup[];
  /** Modules the role needs to work but lacks; listed first, and never staged until Add. */
  gaps: CompanionGap[];
  orgId: string;
  moduleLabel: (key: string) => I18nText;
  summaryActions: (actions: string[]) => { action: string; label: I18nText }[];
  /** A change staged before the PUT settles would be marked saved unsent, so every staging button waits. */
  saving?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  undo: [keys: string[]];
  add: [keys: string[]];
  "open-module": [moduleKey: string];
  save: [];
}>();

const { t, locale } = useI18nTyped();

const listOf = (items: string[], type: Intl.ListFormatType = "conjunction") =>
  raw(new Intl.ListFormat(locale.value, { type }).format(items));

const changeCount = computed(() =>
  props.groups.reduce((count, group) => count + group.changes.length, 0),
);

const allKeys = computed(() =>
  props.groups.flatMap((group) => group.changes.flatMap((change) => change.keys)),
);

const changesLine = computed(() => {
  const count = changeCount.value;
  const modules = props.groups.length;
  return count
    ? t("iam.editRole.yourChangesCount", {
        changes: t("iam.editRole.changeCount", { count }, count),
        modules: t("iam.editRole.presetModuleCount", { count: modules }, modules),
      })
    : t("iam.editRole.yourChangesNone");
});

const gapRows = computed(() =>
  props.gaps.map((gap) => {
    const keys = companionAddKeys(gap, props.orgId);
    return {
      module: gap.module,
      label: t("iam.editRole.presetMissingItem", {
        module: props.moduleLabel(gap.module),
        actions: listOf(props.summaryActions(gap.actions).map((action) => action.label)),
      }),
      why: gap.neededBy.map((need) =>
        t("iam.editRole.companionNeeds", {
          module: props.moduleLabel(need.module),
          reason: t(need.reasonKey),
        }),
      ),
      keys,
      // Streams Get is picked stream by stream, so that row opens the module rather than adding.
      opensModule: keys.length < gap.actions.length,
    };
  }),
);

const calloutTitle = computed(() => {
  const count = gapRows.value.length;
  return t("iam.editRole.notAddedYetTitle", {
    modules: t("iam.editRole.presetModuleCount", { count }, count),
  });
});

const namesLine = computed(() =>
  listOf(
    gapRows.value.map((gap) => gap.label),
    "unit",
  ),
);

// null follows the default: a short list opens, a long one stays out of the way.
const calloutChoice = ref<boolean | null>(null);

const calloutOpen = computed(() => calloutChoice.value ?? gapRows.value.length <= 2);

const toggleCallout = () => {
  calloutChoice.value = !calloutOpen.value;
};

watch(
  () => props.open,
  (open) => {
    if (open) calloutChoice.value = null;
  },
);
</script>
