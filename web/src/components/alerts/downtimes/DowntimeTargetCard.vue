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
  <section
    class="bg-surface-base border-border-default rounded-surface flex flex-col gap-3 border p-3"
    :data-test="`downtime-target-${module}`"
  >
    <header class="flex items-center gap-2">
      <span class="rounded-default bg-surface-subtle grid h-6 w-6 place-items-center">
        <OIcon :name="MODULE_ICONS[module]" size="sm" class="text-text-secondary" />
      </span>
      <span class="text-text-heading text-sm font-semibold">
        {{ t(MODULE_LABEL_KEYS[module]) }}
      </span>
      <span
        v-if="matchCount !== null"
        class="text-text-secondary ms-auto text-xs"
        :data-test="`downtime-target-${module}-count`"
      >
        {{ t(MATCH_KEYS[module], { count: matchCount }, matchCount) }}
      </span>
    </header>

    <OFormSelect
      :name="`targets.${module}.folders`"
      :label="
        module === 'synthetics'
          ? t('alerts.downtimes.form.syntheticsFolders')
          : t('alerts.downtimes.form.alertFolders')
      "
      :options="folderOptions"
      multiple
      searchable
      required
      :data-test="`downtime-target-${module}-folders`"
    />

    <div
      v-if="module === 'synthetics' && tagsOpen"
      class="flex flex-col gap-1"
      :data-test="`downtime-target-${module}-tags-block`"
    >
      <div class="flex items-end gap-2">
        <OFormSelect
          class="min-w-0 flex-1"
          :name="`targets.${module}.tags`"
          :label="t('alerts.downtimes.form.tags')"
          :options="tagOptions"
          :placeholder="t('alerts.downtimes.form.tagPlaceholder')"
          multiple
          searchable
          creatable
          :data-test="`downtime-target-${module}-tags`"
          @create="addTag"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('alerts.downtimes.form.removeBlock')"
          :data-test="`downtime-target-${module}-tags-remove`"
          @click="closeBlock('tags')"
        />
      </div>
      <span class="text-text-secondary text-xs">{{ t("alerts.downtimes.form.tagsHint") }}</span>
    </div>

    <div
      v-if="idsOpen"
      class="flex flex-col gap-1"
      :data-test="`downtime-target-${module}-ids-block`"
    >
      <div class="flex items-end gap-2">
        <OFormSelect
          class="min-w-0 flex-1"
          :name="`targets.${module}.ids`"
          :label="t('alerts.downtimes.form.specificItems')"
          :options="itemOptions"
          :loading="itemsQuery.isPending.value"
          multiple
          searchable
          option-tooltip
          :data-test="`downtime-target-${module}-ids`"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('alerts.downtimes.form.removeBlock')"
          :data-test="`downtime-target-${module}-ids-remove`"
          @click="closeBlock('ids')"
        />
      </div>
      <span class="text-text-secondary text-xs">{{ t("alerts.downtimes.form.itemsHint") }}</span>
    </div>

    <div v-if="!idsOpen || (module === 'synthetics' && !tagsOpen)" class="flex flex-wrap gap-1">
      <OButton
        v-if="module === 'synthetics' && !tagsOpen"
        variant="ghost"
        size="sm"
        icon-left="add"
        :data-test="`downtime-target-${module}-add-tags`"
        @click="openBlock('tags')"
      >
        {{ t("alerts.downtimes.form.addTags") }}
      </OButton>
      <OButton
        v-if="!idsOpen"
        variant="ghost"
        size="sm"
        icon-left="add"
        :data-test="`downtime-target-${module}-add-items`"
        @click="openBlock('ids')"
      >
        {{ t("alerts.downtimes.form.addItems") }}
      </OButton>
    </div>

    <div v-if="module === 'slos'" class="flex flex-col gap-1">
      <OFormToggleGroup
        name="targets.slos.slo_mode"
        :label="t('alerts.downtimes.form.sloMode')"
        label-position="top"
        data-test="downtime-target-slos-mode"
      >
        <OToggleGroupItem value="exclude" size="sm" data-test="downtime-target-slos-mode-exclude">
          {{ t("alerts.downtimes.form.sloExclude") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="count_as_good"
          size="sm"
          data-test="downtime-target-slos-mode-good"
        >
          {{ t("alerts.downtimes.form.sloCountAsGood") }}
        </OToggleGroupItem>
      </OFormToggleGroup>
      <span class="text-text-secondary text-xs" data-test="downtime-target-slos-mode-caption">
        {{
          sloMode === "count_as_good"
            ? t("alerts.downtimes.form.sloCountAsGoodCaption")
            : t("alerts.downtimes.form.sloExcludeCaption")
        }}
      </span>
    </div>

    <p class="text-text-secondary text-xs">
      {{
        module === "synthetics"
          ? t("alerts.downtimes.form.noConditionForChecks")
          : t("alerts.downtimes.form.cardCaption")
      }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { foldersQuery } from "@/services/common.queries";
import type { TargetModule } from "@/services/downtimes";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { useToast } from "@/lib/feedback/Toast/useToast";
import { useDowntimeItems } from "@/composables/downtimes/useDowntimeItems";
import {
  ALL_FOLDERS,
  exclusiveAllFolders,
  type DowntimeFormValues,
} from "@/utils/downtimes/downtimeForm";
import { MODULE_ICONS, MODULE_LABEL_KEYS } from "@/utils/downtimes/targetSummary";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

const MATCH_KEYS: Record<TargetModule, I18nKey> = {
  alerts: "alerts.downtimes.form.matches.alerts",
  anomaly_detections: "alerts.downtimes.form.matches.anomaly_detections",
  synthetics: "alerts.downtimes.form.matches.synthetics",
  slos: "alerts.downtimes.form.matches.slos",
};

const props = withDefaults(
  defineProps<{
    module: TargetModule;
    /** Live match count from the preview; null while it is not known. */
    matchCount?: number | null;
  }>(),
  { matchCount: null },
);

const { t } = useI18nTyped();
const { toast } = useToast();
const orgId = useOrgId();
const form = inject(FORM_CONTEXT_KEY, null);

const path = (field: string) => `targets.${props.module}.${field}`;

const values = form.useStore((s: { values: DowntimeFormValues }) => s.values.targets[props.module]);
const tagsOpen = computed(() => !!values.value?.tags_open);
const idsOpen = computed(() => !!values.value?.ids_open);
const sloMode = computed(() => values.value?.slo_mode);

const folderType = computed(() => (props.module === "synthetics" ? "synthetics" : "alerts"));
const foldersList = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, folderType.value), { enabled: !!orgId.value }),
);

const folderOptions = computed<SelectOption[]>(() => [
  { label: t("alerts.downtimes.allFolders"), value: ALL_FOLDERS },
  ...(foldersList.data.value ?? []).map((f) => ({ label: raw(f.name), value: f.folderId })),
]);

const folderName = (id: string) =>
  foldersList.data.value?.find((f) => f.folderId === id)?.name ?? id;

const { items, query: itemsQuery } = useDowntimeItems(
  () => props.module,
  () => idsOpen.value || (props.module === "synthetics" && tagsOpen.value),
);

const chosenFolders = computed(() => values.value?.folders ?? []);
const inChosenFolders = (folderId: string) =>
  chosenFolders.value.includes(ALL_FOLDERS) || chosenFolders.value.includes(folderId);

const itemOptions = computed<SelectOption[]>(() =>
  items.value
    .filter((item) => inChosenFolders(item.folderId))
    .map((item) => ({
      label: t("alerts.downtimes.form.itemOption", {
        name: item.name,
        folder: folderName(item.folderId),
      }),
      value: item.id,
    })),
);

const tagOptions = computed<SelectOption[]>(() => {
  const tags = new Set<string>([
    ...items.value.flatMap((item) => item.tags),
    ...(values.value?.tags ?? []),
  ]);
  return [...tags].sort().map((tag) => ({ label: raw(tag), value: tag }));
});

const addTag = (value: string) => {
  const tag = String(value ?? "").trim();
  const current = values.value?.tags ?? [];
  if (!tag || current.includes(tag)) return;
  form?.setFieldValue(path("tags"), [...current, tag]);
};

const openBlock = (block: "tags" | "ids") => form?.setFieldValue(path(`${block}_open`), true);

const closeBlock = (block: "tags" | "ids") => {
  form?.setFieldValue(path(`${block}_open`), false);
  form?.setFieldValue(path(block), []);
};

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// "All folders" is exclusive, and a folder change drops chosen items that now fall outside.
watch(chosenFolders, (next, prev) => {
  const fixed = exclusiveAllFolders(next, prev ?? []);
  if (!sameList(fixed, next)) {
    form?.setFieldValue(path("folders"), fixed);
    return;
  }
  const ids = values.value?.ids ?? [];
  const known = new Map(items.value.map((item) => [item.id, item.folderId]));
  const kept = ids.filter((id) => !known.has(id) || inChosenFolders(known.get(id) as string));
  if (kept.length === ids.length) return;
  form?.setFieldValue(path("ids"), kept);
  const dropped = ids.length - kept.length;
  toast({
    variant: "info",
    message: t("toastMessages.downtimes.itemsDropped", { count: dropped }, dropped),
  });
});
</script>
