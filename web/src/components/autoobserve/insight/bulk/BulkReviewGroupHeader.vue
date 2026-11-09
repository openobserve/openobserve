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
  <div class="flex flex-col gap-1 py-1.5" :data-test="`bulk-review-group-${slug}`">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <OCheckbox
        size="sm"
        :model-value="tick"
        :disabled="disabled || group.locked || creatable === 0"
        :aria-label="t('insight.bulk.tickGroup', { group: title })"
        :data-test="`bulk-review-group-tick-${slug}`"
        @update:model-value="(v) => emit('toggle', v === true)"
      />
      <span class="text-text-heading text-sm font-semibold">{{ title }}</span>
      <span class="text-text-secondary" :data-test="`bulk-review-group-meta-${slug}`">
        <template v-for="(part, i) in meta" :key="i">
          <span v-if="i > 0" aria-hidden="true"> · </span>
          <span :class="isSilent(part) ? 'text-status-warning-text' : ''">{{ part }}</span>
        </template>
      </span>
      <OButton
        v-if="!group.locked && group.key !== NO_TEAM"
        variant="ghost-primary"
        size="xs"
        :disabled="disabled"
        :data-test="`bulk-review-group-change-${slug}`"
        @click="editing = !editing"
      >
        {{ t("insight.bulk.change") }}
      </OButton>
      <OButton
        v-if="collapsible"
        variant="ghost-muted"
        size="xs"
        class="ms-auto"
        :data-test="`bulk-review-group-collapse-${slug}`"
        @click="emit('collapse')"
      >
        {{
          collapsed
            ? t("insight.bulk.showGroup", { count: group.rows.length })
            : t("insight.bulk.hideGroup")
        }}
      </OButton>
    </div>

    <p
      v-if="group.key === NO_TEAM"
      class="text-text-secondary ps-7 text-xs"
      :data-test="`bulk-review-group-noteam-${slug}`"
    >
      {{ t("insight.bulk.noTeamWhy") }}
      <OButton
        variant="ghost-primary"
        size="xs"
        :disabled="disabled"
        :data-test="`bulk-review-group-choose-${slug}`"
        @click="editing = !editing"
      >
        {{ t("insight.bulk.chooseFolder") }}
      </OButton>
    </p>

    <p
      v-if="group.locked"
      class="text-text-secondary flex flex-wrap items-center gap-1 ps-7 text-xs"
      :data-test="`bulk-review-group-locked-${slug}`"
    >
      <OIcon name="lock" size="xs" aria-hidden="true" />
      {{ lockedLine(t, group) }}
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`bulk-review-group-request-${slug}`"
        @click="copyRequest"
      >
        {{ copyRequestLabel(t, group) }}
      </OButton>
    </p>

    <div
      v-if="editing"
      class="flex flex-wrap items-end gap-2 ps-7"
      :data-test="`bulk-review-group-editor-${slug}`"
    >
      <OSelect
        v-model="folderId"
        :disabled="disabled"
        class="w-52"
        size="sm"
        label-position="inside"
        :label="t('insight.bulk.changeFolder')"
        :options="folderOptions"
        :data-test="`bulk-review-group-folder-${slug}`"
      />
      <OSelect
        v-model="chosen"
        :disabled="disabled"
        class="w-72"
        size="sm"
        multiple
        label-position="inside"
        :label="t('insight.bulk.changeDestinations')"
        :options="destinationOptions"
        :data-test="`bulk-review-group-destinations-${slug}`"
      />
      <OButton
        variant="outline"
        size="sm"
        :disabled="disabled"
        :data-test="`bulk-review-group-apply-${slug}`"
        @click="apply"
      >
        {{ t("insight.bulk.changeDone") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyRequestLabel, groupMeta, groupTitle, lockedLine, requestText } from "./bulkCopy";
import {
  NO_TEAM,
  groupTick,
  isTickable,
  type FolderRef,
  type ReviewGroup,
  type ReviewRow,
} from "./useBulkReview";

const props = defineProps<{
  group: ReviewGroup;
  all: ReviewRow[];
  ticked: Set<string>;
  collapsible: boolean;
  collapsed: boolean;
  folders: FolderRef[];
  destinations: string[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  toggle: [on: boolean];
  collapse: [];
  change: [folder: FolderRef, destinations: string[]];
  edit: [];
}>();

const { t, locale } = useI18nTyped();
const editing = ref(false);
const folderId = ref(props.group.folders[0]?.id ?? "");
const chosen = ref<string[]>([...props.group.destinations]);

watch(editing, (open) => {
  if (!open) return;
  emit("edit");
  folderId.value = props.group.folders[0]?.id ?? "";
  chosen.value = [...props.group.destinations];
});

const slug = computed(() => props.group.key.replace(/[^a-zA-Z0-9_-]+/g, "-"));
const title = computed(() => groupTitle(t, props.group));
const creatable = computed(() => props.group.rows.filter(isTickable).length);
const tick = computed(() => groupTick(props.group, props.ticked));
const tickedCount = computed(
  () => props.group.rows.filter((r) => isTickable(r) && props.ticked.has(r.key)).length,
);
const meta = computed(() => groupMeta(t, String(locale.value), props.group, tickedCount.value));
const silent = computed(() => t("insight.bulk.notifiesNone"));
const isSilent = (part: I18nText) => part === silent.value;

const folderOptions = computed(() =>
  props.folders.map((f) => ({ label: raw(f.name), value: f.id })),
);
const destinationOptions = computed(() =>
  [...new Set([...props.destinations, ...props.group.destinations])].map((d) => ({
    label: raw(d),
    value: d,
  })),
);

const apply = () => {
  if (props.disabled) return;
  const folder = props.folders.find((f) => f.id === folderId.value);
  if (folder) emit("change", folder, [...chosen.value]);
  editing.value = false;
};

const copyRequest = () =>
  copyToClipboard(requestText(t, String(locale.value), props.group, props.all), t, {
    successMessage: t("insight.bulk.requestCopied"),
  });
</script>
