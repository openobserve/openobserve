<!--
Copyright 2026 OpenObserve Inc.

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
  <ODialog
    :open="state.open"
    size="lg"
    :title="t('dashboard.saveConflict.title')"
    :persistent="!!state.busy"
    data-test="dashboard-save-conflict-dialog"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-4">
      <OBanner
        v-if="state.notice === 'savedAgain'"
        variant="warning"
        icon="warning"
        :content="t('dashboard.saveConflict.savedAgain')"
        data-test="dashboard-save-conflict-saved-again"
      />
      <OBanner
        v-if="state.notice === 'stillUnresolved'"
        variant="warning"
        icon="warning"
        :content="t('dashboard.saveConflict.stillUnresolved')"
        data-test="dashboard-save-conflict-still-unresolved"
      />
      <OBanner
        v-if="state.notice === 'saveFailed'"
        variant="error"
        icon="error"
        :content="t('dashboard.saveConflict.saveFailed', { message: state.errorMessage })"
        data-test="dashboard-save-conflict-save-failed"
      />

      <div
        v-if="state.step === 'loading'"
        class="flex flex-col gap-3"
        data-test="dashboard-save-conflict-loading"
      >
        <div class="text-text-secondary flex items-center gap-2 text-sm">
          <OSpinner size="xs" />
          {{ t("dashboard.saveConflict.checking") }}
        </div>
        <OSkeleton class="h-4 w-3/4" />
        <OSkeleton class="h-4 w-11/12" />
        <OSkeleton class="h-4 w-1/2" />
      </div>

      <OBanner
        v-else-if="state.step === 'error'"
        variant="error"
        icon="error"
        :content="t('dashboard.saveConflict.loadFailed')"
        data-test="dashboard-save-conflict-load-failed"
      />

      <template v-else-if="state.step === 'main'">
        <div
          class="text-text-body flex items-center gap-2 text-sm"
          data-test="dashboard-save-conflict-saved-by"
        >
          <OIcon name="history" size="sm" class="text-text-secondary" />
          <span>{{ savedByText }}</span>
        </div>
        <div
          v-if="state.myChange"
          class="text-text-body flex items-center gap-2 text-sm"
          data-test="dashboard-save-conflict-my-change"
        >
          <OIcon name="edit-note" size="sm" class="text-text-secondary" />
          <span>{{ t("dashboard.saveConflict.yourChange", { change: state.myChange }) }}</span>
        </div>

        <div v-if="state.isPanelEditor">
          <OBadge
            v-if="state.panelTouched"
            variant="warning-soft"
            icon="warning"
            data-test="dashboard-save-conflict-panel-touched"
          >
            {{ t("dashboard.saveConflict.panelTouched") }}
          </OBadge>
          <OBadge
            v-else
            variant="success-soft"
            icon="check-circle"
            data-test="dashboard-save-conflict-panel-untouched"
          >
            {{ t("dashboard.saveConflict.panelUntouched") }}
          </OBadge>
        </div>

        <div
          v-if="comparison"
          class="border-border-default rounded-default grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1.5 border px-3 py-2 text-sm"
          data-test="dashboard-save-conflict-panel-compare"
        >
          <span class="text-text-secondary text-xs">{{
            t("dashboard.saveConflict.compareField")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            t("dashboard.saveConflict.compareTheirs")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            t("dashboard.saveConflict.compareYours")
          }}</span>
          <template v-for="row in comparison" :key="row.key">
            <span class="text-text-heading font-medium">{{ row.label }}</span>
            <OTruncatedText
              class="text-text-body min-w-0"
              :data-test="`dashboard-save-conflict-compare-${row.key}-theirs`"
              >{{ row.theirs }}</OTruncatedText
            >
            <OTruncatedText
              class="text-text-body min-w-0"
              :data-test="`dashboard-save-conflict-compare-${row.key}-yours`"
              >{{ row.yours }}</OTruncatedText
            >
          </template>
        </div>

        <div class="border-border-default rounded-default border">
          <OCollapsible v-model="changesOpen" data-test="dashboard-save-conflict-changes">
            <template #trigger="{ open }">
              <div class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <OIcon :name="open ? 'expand-more' : 'chevron-right'" size="sm" />
                <span class="text-text-heading font-medium">
                  {{ t("dashboard.saveConflict.whatChanged") }}
                </span>
                <OBadge
                  v-for="chip in chips"
                  :key="chip.key"
                  :variant="chip.variant"
                  size="xs"
                  :data-test="`dashboard-save-conflict-chip-${chip.key}`"
                >
                  {{ chip.label }}
                </OBadge>
              </div>
            </template>
            <div class="border-border-default border-t px-3 py-2">
              <ul v-if="changeRows.length" class="flex flex-col gap-1.5">
                <li
                  v-for="row in changeRows"
                  :key="row.key"
                  class="flex min-w-0 items-center gap-2 text-sm"
                  :data-test="row.dataTest"
                >
                  <span class="text-text-secondary w-16 shrink-0 text-xs">
                    {{ row.kind }}
                  </span>
                  <OBadge
                    :variant="CHANGE_BADGE[row.change].variant"
                    :icon="CHANGE_BADGE[row.change].icon"
                    size="xs"
                  >
                    {{ changeLabel(row.change) }}
                  </OBadge>
                  <OTruncatedText class="text-text-heading min-w-0 flex-1 font-medium">
                    {{ row.name }}
                  </OTruncatedText>
                </li>
              </ul>
              <p
                v-else
                class="text-text-secondary text-sm"
                data-test="dashboard-save-conflict-no-changes"
              >
                {{ emptyChangesText }}
              </p>
            </div>
          </OCollapsible>
        </div>

        <OBanner
          v-if="state.mergeUnavailable"
          variant="warning"
          icon="warning"
          :content="t('dashboard.saveConflict.mergeUnavailable')"
          data-test="dashboard-save-conflict-merge-unavailable"
        />

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <template v-for="item in legend" :key="item.key">
            <dt class="text-text-heading font-medium">{{ item.label }}</dt>
            <dd class="text-text-secondary">{{ item.hint }}</dd>
          </template>
        </dl>
      </template>

      <OBanner
        v-else-if="state.step === 'confirm'"
        variant="error-soft"
        icon="warning"
        data-test="dashboard-save-conflict-confirm"
      >
        <div class="flex flex-col gap-2">
          <span class="font-medium">{{ impact.heading }}</span>
          <ul class="flex list-disc flex-col gap-1 ps-5">
            <li v-for="line in impact.lines" :key="line">{{ line }}</li>
          </ul>
          <span data-test="dashboard-save-conflict-confirm-saved-by">{{ savedByText }}</span>
          <span>{{ t("dashboard.saveConflict.cannotUndo") }}</span>
        </div>
      </OBanner>

      <div
        v-else-if="state.step === 'review'"
        class="flex flex-col gap-3"
        data-test="dashboard-save-conflict-review"
      >
        <OBanner
          variant="warning"
          icon="call-merge"
          :content="t('dashboard.saveConflict.reviewIntro')"
        />
        <span class="text-text-heading text-sm font-medium">
          {{ t("dashboard.saveConflict.reviewHeading") }}
        </span>
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="row in state.mergedRows"
            :key="row.key"
            class="flex min-w-0 items-center gap-2 text-sm"
            :data-test="`dashboard-save-conflict-merged-${row.key}`"
          >
            <OTruncatedText class="text-text-body min-w-0 flex-1">{{ row.name }}</OTruncatedText>
            <OBadge v-if="row.tag" :variant="MERGE_TAG[row.tag]" size="xs">
              {{ tagLabel(row.tag) }}
            </OBadge>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <OButton
            v-if="state.step === 'main' || state.step === 'loading'"
            variant="outline-destructive"
            size="sm-action"
            :disabled="!actionsReady || !state.hasMine"
            data-test="dashboard-save-conflict-overwrite"
            @click="startOverwrite"
          >
            {{ t("dashboard.saveConflict.overwrite") }}
          </OButton>
          <OButton
            v-else-if="state.step !== 'error'"
            variant="ghost"
            size="sm-action"
            :disabled="!!state.busy"
            data-test="dashboard-save-conflict-back"
            @click="back"
          >
            {{ t("dashboard.saveConflict.back") }}
          </OButton>
        </div>

        <div class="flex items-center gap-2">
          <template v-if="state.step === 'main' || state.step === 'loading'">
            <OButton
              v-for="action in mainActions"
              :key="action.key"
              :variant="action.variant"
              size="sm-action"
              :disabled="!actionsReady || action.disabled"
              :loading="state.busy === action.key"
              :data-test="`dashboard-save-conflict-${action.key}`"
              @click="action.run"
            >
              {{ action.label }}
            </OButton>
          </template>

          <template v-else-if="state.step === 'error'">
            <OButton variant="outline" size="sm-action" @click="close">
              {{ t("common.close") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              data-test="dashboard-save-conflict-retry"
              @click="retry"
            >
              {{ t("dashboard.saveConflict.retry") }}
            </OButton>
          </template>

          <OButton
            v-else-if="state.step === 'confirm'"
            variant="destructive"
            size="sm-action"
            :loading="state.busy === 'overwrite'"
            data-test="dashboard-save-conflict-confirm-overwrite"
            @click="confirmOverwrite"
          >
            {{
              impact.removes
                ? t("dashboard.saveConflict.removeAndOverwrite")
                : t("dashboard.saveConflict.overwrite")
            }}
          </OButton>

          <template v-else-if="state.step === 'review'">
            <OButton
              variant="outline-destructive"
              size="sm-action"
              :disabled="!!state.busy"
              data-test="dashboard-save-conflict-discard-merge"
              @click="discardMerge"
            >
              {{ t("dashboard.saveConflict.discard") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :loading="state.busy === 'saveMerged'"
              data-test="dashboard-save-conflict-save-merged"
              @click="saveMerged"
            >
              {{ t("dashboard.saveConflict.saveMerged") }}
            </OButton>
          </template>
        </div>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDashboardSaveConflictDialog } from "@/composables/dashboard/useDashboardSaveConflict";
import type { MergedPanelRow } from "@/composables/dashboard/dashboardSaveConflictState";
import {
  countChanges,
  formatClockTime,
  formatRelativeTime,
  type ConflictChange,
  type ConflictChangeType,
  type ConflictItemKind,
  type DashboardSettingKey,
} from "@/utils/dashboard/saveConflict";

type MainActionKey = "reload" | "merge";

interface MainAction {
  key: MainActionKey;
  label: I18nText;
  variant: ButtonVariant;
  primary: boolean;
  disabled: boolean;
  run: () => void;
}

const CHANGE_BADGE: Record<ConflictChangeType, { variant: BadgeVariant; icon: IconName }> = {
  added: { variant: "success-soft", icon: "add" },
  changed: { variant: "warning-soft", icon: "edit" },
  removed: { variant: "error-soft", icon: "remove" },
};

const MERGE_TAG: Record<NonNullable<MergedPanelRow["tag"]>, BadgeVariant> = {
  yours: "primary-soft",
  theirsNew: "success-soft",
  theirsEdited: "warning-soft",
};

const KINDS: ConflictItemKind[] = ["panel", "tab", "variable"];

const { t, locale } = useI18nTyped();
const {
  state,
  reload,
  startOverwrite,
  confirmOverwrite,
  merge,
  saveMerged,
  discardMerge,
  back,
  retry,
  close,
} = useDashboardSaveConflictDialog();

const changesOpen = ref(true);
watch(
  () => state.open,
  (open) => {
    if (open) changesOpen.value = true;
  },
);

const actionsReady = computed(() => state.step === "main" && !state.busy);

const listFormat = (items: string[]) =>
  new Intl.ListFormat(locale.value, { style: "long", type: "conjunction" }).format(items);

const kindLabel = (kind: ConflictItemKind) =>
  ({
    panel: t("dashboard.saveConflict.kindPanel"),
    tab: t("dashboard.saveConflict.kindTab"),
    variable: t("dashboard.saveConflict.kindVariable"),
  })[kind];

const changeLabel = (change: ConflictChangeType) =>
  ({
    added: t("dashboard.saveConflict.added"),
    changed: t("dashboard.saveConflict.changed"),
    removed: t("dashboard.saveConflict.removed"),
  })[change];

const tagLabel = (tag: NonNullable<MergedPanelRow["tag"]>) =>
  ({
    yours: t("dashboard.saveConflict.tagYours"),
    theirsNew: t("dashboard.saveConflict.tagTheirsNew"),
    theirsEdited: t("dashboard.saveConflict.tagTheirsEdited"),
  })[tag];

const countPhrase = (kind: ConflictItemKind, count: number) =>
  ({
    panel: t("dashboard.saveConflict.panelCount", { count }, count),
    tab: t("dashboard.saveConflict.tabCount", { count }, count),
    variable: t("dashboard.saveConflict.variableCount", { count }, count),
  })[kind];

const itemsPhrase = (changes: ConflictChange[], type: ConflictChangeType) => {
  const counts = countChanges(changes);
  return listFormat(
    KINDS.filter((kind) => counts[kind][type] > 0).map((kind) =>
      countPhrase(kind, counts[kind][type]),
    ),
  );
};

const chips = computed(() => {
  const out: { key: string; label: I18nText; variant: BadgeVariant }[] = [];
  const typed = (type: ConflictChangeType) => state.changes.filter((c) => c.change === type);
  if (typed("added").length)
    out.push({
      key: "added",
      variant: "success-soft",
      label: t("dashboard.saveConflict.chipAdded", { items: itemsPhrase(state.changes, "added") }),
    });
  if (typed("changed").length)
    out.push({
      key: "changed",
      variant: "warning-soft",
      label: t("dashboard.saveConflict.chipChanged", {
        items: itemsPhrase(state.changes, "changed"),
      }),
    });
  if (typed("removed").length)
    out.push({
      key: "removed",
      variant: "error-soft",
      label: t("dashboard.saveConflict.chipRemoved", {
        items: itemsPhrase(state.changes, "removed"),
      }),
    });
  return out;
});

const emptyChangesText = computed(() =>
  state.hasBase
    ? t("dashboard.saveConflict.nothingChanged")
    : t("dashboard.saveConflict.baseUnknown"),
);

const settingLabel = (key: DashboardSettingKey) =>
  ({
    title: t("dashboard.saveConflict.settingTitle"),
    description: t("dashboard.saveConflict.settingDescription"),
    defaultDatetimeDuration: t("dashboard.saveConflict.settingTimeRange"),
    showDynamicFilters: t("dashboard.saveConflict.settingDynamicFilters"),
    other: t("dashboard.saveConflict.settingOther"),
  })[key];

const settingsText = computed(() => listFormat(state.changedSettings.map(settingLabel)));

const changeRows = computed(() => {
  const rows = state.changes.map((change) => ({
    key: `${change.kind}-${change.key}`,
    kind: kindLabel(change.kind),
    change: change.change,
    name: change.previousName
      ? t("dashboard.saveConflict.renamedFrom", { name: change.name, from: change.previousName })
      : raw(change.name),
    dataTest: `dashboard-save-conflict-change-${change.kind}-${change.change}`,
  }));
  if (state.changedSettings.length)
    rows.push({
      key: "settings",
      kind: t("dashboard.saveConflict.kindSettings"),
      change: "changed",
      name: raw(settingsText.value),
      dataTest: "dashboard-save-conflict-change-settings-changed",
    });
  return rows;
});

const comparison = computed(() => {
  const c = state.panelComparison;
  if (!c) return null;
  const removed = t("dashboard.saveConflict.compareRemoved");
  const sameOrDifferent = c.sameOtherFields
    ? t("dashboard.saveConflict.compareSame")
    : t("dashboard.saveConflict.compareDifferent");
  return [
    {
      key: "title",
      label: t("dashboard.saveConflict.compareTitle"),
      theirs: c.theirsRemoved ? removed : raw(c.theirsTitle),
      yours: raw(c.mineTitle),
    },
    {
      key: "other",
      label: t("dashboard.saveConflict.compareOther"),
      theirs: c.theirsRemoved ? removed : sameOrDifferent,
      yours: sameOrDifferent,
    },
  ];
});

const savedByText = computed(() => {
  const ms = state.latestUpdatedAt;
  if (!ms) return t("dashboard.saveConflict.savedByUnknown");
  return t("dashboard.saveConflict.savedBy", {
    relative: formatRelativeTime(ms, locale.value),
    time: formatClockTime(ms, locale.value),
  });
});

const legend = computed(() => {
  const items = [
    {
      key: "reload",
      label: t("dashboard.saveConflict.reload"),
      hint: t("dashboard.saveConflict.reloadHint"),
    },
    {
      key: "overwrite",
      label: t("dashboard.saveConflict.overwrite"),
      hint: t("dashboard.saveConflict.overwriteHint"),
    },
  ];
  if (canMerge.value)
    items.push({
      key: "merge",
      label: t("dashboard.saveConflict.merge"),
      hint: t("dashboard.saveConflict.mergeHint"),
    });
  return items;
});

// Merge only when their save left my panel alone; otherwise it would silently drop their edit of it.
const canMerge = computed(() => state.isPanelEditor && !state.panelTouched);

// Safe default: Merge when it is offered, Reload otherwise.
const mainActions = computed<MainAction[]>(() => {
  const actions: MainAction[] = [
    {
      key: "reload",
      label: t("dashboard.saveConflict.reload"),
      variant: canMerge.value ? "ghost" : "primary",
      primary: !canMerge.value,
      disabled: false,
      run: reload,
    },
  ];
  if (canMerge.value)
    actions.push({
      key: "merge",
      label: t("dashboard.saveConflict.merge"),
      variant: "primary",
      primary: true,
      disabled: !state.hasMine,
      run: merge,
    });
  return actions.sort((a, b) => Number(a.primary) - Number(b.primary));
});

const impact = computed(() => {
  const theirs = (type: ConflictChangeType) => state.changes.filter((c) => c.change === type);
  const names = (list: ConflictChange[]) => listFormat(list.map((c) => c.name));
  const lines: I18nText[] = [];
  const added = theirs("added");
  const changed = theirs("changed");
  const removed = theirs("removed");
  if (added.length)
    lines.push(
      t("dashboard.saveConflict.impactRemoves", {
        items: itemsPhrase(added, "added"),
        names: names(added),
      }),
    );
  if (changed.length)
    lines.push(
      t("dashboard.saveConflict.impactReverts", {
        items: itemsPhrase(changed, "changed"),
        names: names(changed),
      }),
    );
  if (removed.length)
    lines.push(
      t("dashboard.saveConflict.impactRestores", {
        items: itemsPhrase(removed, "removed"),
        names: names(removed),
      }),
    );
  if (state.changedSettings.length)
    lines.push(t("dashboard.saveConflict.impactSettings", { settings: settingsText.value }));
  if (!lines.length)
    lines.push(
      state.hasBase
        ? t("dashboard.saveConflict.impactNothing")
        : t("dashboard.saveConflict.impactUnknown"),
    );
  return {
    removes: added.length > 0,
    heading: added.length
      ? t("dashboard.saveConflict.overwriteRemoves", { items: itemsPhrase(added, "added") })
      : t("dashboard.saveConflict.overwriteReplaces"),
    lines,
  };
});

const onOpenChange = (open: boolean) => {
  if (!open) close();
};
</script>
