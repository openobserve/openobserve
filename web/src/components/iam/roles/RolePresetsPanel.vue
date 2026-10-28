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
  <aside
    ref="root"
    :aria-label="t('iam.editRole.presetsTitle')"
    data-test="edit-role-presets-panel"
    class="bg-surface-panel flex min-h-0 flex-col"
  >
    <template v-if="!detail">
      <div
        class="border-border-default flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-2"
      >
        <span
          class="rounded-default bg-tabs-active-bg text-tabs-active-text inline-flex size-8 shrink-0 items-center justify-center"
        >
          <OIcon name="library-add" size="sm" />
        </span>
        <span class="min-w-0">
          <span class="text-text-heading block text-sm font-semibold">
            {{ t("iam.editRole.presetsTitle") }}
          </span>
          <span class="text-text-secondary block text-xs">
            {{ t("iam.editRole.presetsSubtitle") }}
          </span>
        </span>
        <OButton
          variant="ghost"
          size="icon-xs"
          class="ms-auto"
          :aria-label="t('iam.editRole.presetsClose')"
          data-test="edit-role-presets-close"
          @click="emit('close')"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <section
          v-for="section in sections"
          :key="section.id"
          :data-test="`edit-role-preset-section-${section.id}`"
        >
          <h3 class="text-text-secondary px-2 pt-3 pb-1 text-xs font-semibold">
            {{ section.label }}
          </h3>
          <div class="grid gap-1.5">
            <EmptyStateActionCard
              v-for="item in section.items"
              :key="item.preset.id"
              size="compact"
              class="w-full max-w-full"
              :icon="item.preset.icon"
              :label="t(item.preset.titleKey)"
              :sublabel="t(item.preset.descriptionKey)"
              :unavailable="loading"
              :data-test="`edit-role-preset-${item.preset.id}`"
              @click="openPreset(item.preset.id)"
            >
              <template #label>
                <span class="flex min-w-0 items-center gap-2">
                  <OTruncatedText class="flex-1">{{ t(item.preset.titleKey) }}</OTruncatedText>
                  <OSkeleton
                    v-if="item.badge === 'loading'"
                    class="h-5 w-8 shrink-0"
                    :aria-label="
                      loading
                        ? t('components.skeleton.loading')
                        : t('iam.editRole.presetLoadingStreams')
                    "
                    :data-test="`edit-role-preset-${item.preset.id}-status`"
                  />
                  <template v-else-if="item.badge === 'adds'">
                    <!-- Hidden from readers so the badge text stays "+N"; the sentence below names it. -->
                    <OBadge
                      variant="primary-soft"
                      size="sm"
                      class="shrink-0"
                      aria-hidden="true"
                      :data-test="`edit-role-preset-${item.preset.id}-status`"
                    >
                      <OTooltip :content="addsHint(item.adds)" />{{ raw(`+${item.adds}`) }}
                    </OBadge>
                    <span class="sr-only">{{ addsHint(item.adds) }}</span>
                  </template>
                  <OBadge
                    v-else-if="item.badge === 'in-role'"
                    variant="success-soft"
                    size="sm"
                    class="shrink-0"
                    :data-test="`edit-role-preset-${item.preset.id}-status`"
                  >
                    <OTooltip :content="t('iam.editRole.presetInRoleTooltip')" />{{
                      t("iam.editRole.presetInRole")
                    }}
                  </OBadge>
                </span>
              </template>
            </EmptyStateActionCard>
          </div>
        </section>
      </div>
    </template>

    <div v-else class="flex min-h-0 flex-1 flex-col" data-test="edit-role-preset-detail">
      <div
        class="border-border-default flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-2"
      >
        <OButton
          variant="ghost"
          size="icon-xs"
          :aria-label="t('iam.editRole.presetBack')"
          data-test="edit-role-preset-back"
          @click="closePreset"
        >
          <OIcon name="chevron-left" size="sm" />
        </OButton>
        <span
          class="rounded-default inline-flex size-8 shrink-0 items-center justify-center"
          :class="groupTone(detail.tone)"
        >
          <OIcon :name="detail.icon as IconName" size="sm" />
        </span>
        <span class="min-w-0">
          <span class="text-text-heading block text-sm font-semibold">
            {{ t(detail.titleKey) }}
          </span>
          <span class="text-text-secondary block text-xs">
            {{ t(detail.descriptionKey) }}
          </span>
        </span>
        <OButton
          variant="ghost"
          size="icon-xs"
          class="ms-auto"
          :aria-label="t('iam.editRole.presetsClose')"
          data-test="edit-role-presets-close"
          @click="emit('close')"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <div
          v-if="detailLoading"
          class="flex flex-col gap-2 px-1 py-3"
          data-test="edit-role-preset-loading"
        >
          <OSkeleton
            type="text"
            class="w-3/4"
            :aria-label="t('iam.editRole.presetLoadingStreams')"
          />
          <OSkeleton type="text" class="w-1/2" aria-hidden="true" />
        </div>

        <div
          v-else-if="detailPreview?.status === 'failed'"
          class="flex flex-col items-start gap-2 px-1 py-3"
          data-test="edit-role-preset-failed"
        >
          <span class="text-badge-warning-soft-text flex items-start gap-1 text-xs">
            <OIcon name="warning" size="sm" class="shrink-0" />
            {{ t("iam.editRole.presetStreamsFailed") }}
          </span>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            data-test="edit-role-preset-retry"
            @click="requestStreams"
          >
            {{ t("iam.editRole.presetRetry") }}
          </OButton>
        </div>

        <template v-else-if="detailPreview">
          <div class="border-border-subtle border-b px-1 pt-2 pb-2.5">
            <p class="text-compact text-text-body" data-test="edit-role-preset-summary">
              {{ summary.join(" ") }}
            </p>
            <span
              v-if="detailPreview.noMatchingStreams && detailPreview.adds.length"
              class="text-text-secondary mt-0.5 block text-xs"
            >
              {{ t("iam.editRole.presetNoMatchingStreams") }}
            </span>
            <span
              v-if="detailPreview.skipped"
              class="text-text-secondary mt-0.5 block text-xs"
              data-test="edit-role-preset-skipped"
            >
              {{
                t(
                  "iam.editRole.presetSummarySkipped",
                  { count: detailPreview.skipped },
                  detailPreview.skipped,
                )
              }}
            </span>
            <div
              v-if="missingLine"
              class="text-badge-warning-soft-text mt-1.5 flex items-start gap-1 text-xs"
              data-test="edit-role-preset-missing"
            >
              <OIcon name="warning" size="sm" class="shrink-0" />
              <span>{{ missingLine }}</span>
            </div>
            <div
              v-else
              class="text-badge-success-soft-text mt-1.5 flex items-center gap-1 text-xs"
              data-test="edit-role-preset-ok"
            >
              <OIcon name="check-circle" size="sm" class="shrink-0" />
              {{ t("iam.editRole.presetNothingMissing") }}
            </div>
          </div>

          <ul v-if="rows.length" class="py-1">
            <li
              v-for="row in rows"
              :key="row.id"
              class="flex items-start gap-2 px-1 py-1.5"
              :data-test="`edit-role-preset-row-${row.id}`"
            >
              <OIcon
                :name="moduleIcon(row.resource)"
                size="sm"
                class="text-text-secondary mt-0.5 shrink-0"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-compact text-text-heading">{{ moduleLabel(row.resource) }}</span>
                <OTruncatedText class="text-text-secondary text-xs">
                  {{ entityLabel(row.resource, row.entity) }}
                </OTruncatedText>
              </span>
              <span class="flex max-w-30 flex-wrap justify-end gap-1">
                <OBadge
                  v-for="action in row.actions"
                  :key="action.action"
                  variant="primary-soft"
                  size="sm"
                >
                  {{ action.label }}
                </OBadge>
              </span>
            </li>
          </ul>
        </template>
      </div>

      <div
        v-if="detailPreview?.status !== 'failed'"
        class="border-border-default shrink-0 border-t p-3"
      >
        <OButton
          variant="outline"
          size="sm-action"
          block
          :disabled="!addCount || applying"
          data-test="edit-role-preset-apply"
          @click="applyPreset"
        >
          {{ addLabel }}
        </OButton>
        <p class="text-text-secondary mt-1.5 text-center text-xs">
          {{ t("iam.editRole.presetApplyNote") }}
        </p>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { splitGrantKey } from "@/composables/iam/useRoleGrants";
import type { PresetInfo, PresetPreview } from "@/composables/iam/useRolePresets";
import { moduleIcon } from "@/components/iam/roles/roleModules";
import { groupTone } from "@/components/iam/roles/roleGroupTone";

const props = defineProps<{
  presets: PresetInfo[];
  previewPreset: (id: string) => PresetPreview;
  /** The saved grants are still loading, so no preset can be counted or opened yet. */
  loading: boolean;
  /** A preset is still being staged; a second Add now could flip its grants back off. */
  applying: boolean;
  moduleLabel: (key: string) => I18nText;
  entityLabel: (resource: string, entity: string) => I18nText;
  summaryActions: (actions: string[]) => { action: string; label: I18nText }[];
}>();

const emit = defineEmits<{
  apply: [presetId: string];
  "load-streams": [];
  close: [];
}>();

const { t, locale } = useI18nTyped();

const WRITE_ACTIONS = new Set(["AllowAll", "AllowPost", "AllowPut", "AllowDelete"]);

const SECTIONS = [
  { id: "builtin", labelKey: "iam.editRole.presetsSectionBuiltin" },
  { id: "job", labelKey: "iam.editRole.presetsSectionJob" },
] as const;

const root = ref<HTMLElement | null>(null);
const selected = ref<string | null>(null);

// Computed, never cached from mount: the role can change in another module while the panel stays open.
const previews = computed(
  () => new Map(props.presets.map((preset) => [preset.id, props.previewPreset(preset.id)])),
);

// Stream lists load only once a preset that needs them is opened, so a plain visit fetches nothing.
const streamsRequested = ref(false);

const requestStreams = () => {
  streamsRequested.value = true;
  emit("load-streams");
};

type Badge = "loading" | "adds" | "in-role" | null;

// "In Role" only when the role holds every grant; an unloaded, failed or empty stream lookup shows nothing rather than a false claim.
const badgeOf = (preview: PresetPreview | undefined): Badge => {
  if (props.loading) return "loading";
  if (!preview || preview.status === "failed") return null;
  if (preview.status === "loading") return streamsRequested.value ? "loading" : null;
  if (preview.adds.length) return "adds";
  return preview.noMatchingStreams ? null : "in-role";
};

const sections = computed(() =>
  SECTIONS.map((section) => ({
    id: section.id,
    label: t(section.labelKey),
    items: props.presets
      .filter((preset) => preset.section === section.id)
      .map((preset) => {
        const preview = previews.value.get(preset.id);
        return { preset, badge: badgeOf(preview), adds: preview?.adds.length ?? 0 };
      }),
  })).filter((section) => section.items.length),
);

const addsHint = (count: number) => t("iam.editRole.presetAddsTooltip", { count }, count);

const detail = computed(() => props.presets.find((preset) => preset.id === selected.value));
const detailPreview = computed(() => detail.value && previews.value.get(detail.value.id));
const detailLoading = computed(() => detailPreview.value?.status === "loading");
const addCount = computed(() =>
  detailPreview.value?.status === "ready" ? detailPreview.value.adds.length : 0,
);
const restoreCount = computed(() =>
  detailPreview.value?.status === "ready" ? detailPreview.value.restores.length : 0,
);

// A restore only cancels a removal the admin staged, so it is never counted as added.
const newGrants = computed(() => {
  const preview = detailPreview.value;
  if (preview?.status !== "ready") return [];
  const restores = new Set(preview.restores);
  return preview.adds.filter((key) => !restores.has(key)).map(splitGrantKey);
});

const addLabel = computed(() => {
  if (detailLoading.value) return t("iam.editRole.presetLoadingStreams");
  const added = newGrants.value.length;
  if (added) return t("iam.editRole.presetAddButton", { count: added }, added);
  const kept = restoreCount.value;
  return kept
    ? t("iam.editRole.presetRestoreButton", { count: kept }, kept)
    : t("iam.editRole.presetNothingToAdd");
});

const listOf = (items: string[], type: Intl.ListFormatType = "conjunction") =>
  raw(new Intl.ListFormat(locale.value, { type }).format(items));

// One row per resource and entity, as the grant table lists them: `afolder:_all_default:AllowAll` -> Alert Folders, All Alert Folders, All.
const rows = computed(() => {
  const byObject = new Map<string, { resource: string; entity: string; actions: string[] }>();
  (detailPreview.value?.adds ?? []).forEach((key) => {
    const { resource, entity, permission, object } = splitGrantKey(key);
    const row = byObject.get(object) ?? { resource, entity, actions: [] };
    row.actions.push(permission);
    byObject.set(object, row);
  });
  return [...byObject.entries()].map(([id, row]) => ({
    ...row,
    id,
    actions: props.summaryActions(row.actions),
  }));
});

const summary = computed(() => {
  const preview = detailPreview.value;
  if (!preview?.adds.length) {
    return [
      preview?.noMatchingStreams
        ? t("iam.editRole.presetNoMatchingStreams")
        : t("iam.editRole.presetSummaryHasAll"),
    ];
  }
  const lines: I18nText[] = [];
  const count = newGrants.value.length;
  if (count) {
    const modules = new Set(newGrants.value.map((grant) => grant.resource)).size;
    // A restored write is staged like a new one, so it still makes the preset more than view only.
    const written = [
      ...new Set(
        preview.adds
          .map(splitGrantKey)
          .filter((grant) => WRITE_ACTIONS.has(grant.permission))
          .map((grant) => String(props.moduleLabel(grant.resource))),
      ),
    ];
    lines.push(
      t("iam.editRole.presetSummaryAdds", {
        permissions: t("iam.editRole.presetPermissionCount", { count }, count),
        modules: t("iam.editRole.presetModuleCount", { count: modules }, modules),
      }),
      written.length
        ? t("iam.editRole.presetSummaryWrite", { modules: listOf(written) })
        : t("iam.editRole.presetSummaryViewOnly"),
    );
  }
  if (restoreCount.value) {
    lines.push(
      t("iam.editRole.presetSummaryRestores", { count: restoreCount.value }, restoreCount.value),
    );
  }
  return lines;
});

// "Still missing after adding: Streams: Get, Destinations: List".
const missingLine = computed(() => {
  const gaps = detailPreview.value?.stillMissing ?? [];
  if (!gaps.length) return null;
  const items = gaps.map((gap) =>
    t("iam.editRole.presetMissingItem", {
      module: props.moduleLabel(gap.module),
      actions: listOf(props.summaryActions(gap.actions).map((action) => action.label)),
    }),
  );
  return t("iam.editRole.presetStillMissing", { list: listOf(items, "unit") });
});

const focusTest = (dataTest: string) =>
  nextTick(() => root.value?.querySelector<HTMLElement>(`[data-test="${dataTest}"]`)?.focus());

const openPreset = (id: string) => {
  selected.value = id;
  const preview = previews.value.get(id);
  // A stream preset asks on every open, so streams ingested since its lookup can show; a fresh matched list is reused.
  if (preview?.status !== "ready" || preview.noMatchingStreams !== undefined) requestStreams();
  focusTest("edit-role-preset-back");
};

// Back on the list, focus returns to the row that was open instead of falling to the page.
const closePreset = () => {
  const id = selected.value;
  selected.value = null;
  if (id) focusTest(`edit-role-preset-${id}`);
};

const applyPreset = () => {
  if (!selected.value || !addCount.value || props.applying) return;
  emit("apply", selected.value);
  closePreset();
};
</script>
