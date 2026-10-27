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
  <div class="flex flex-col gap-4" data-test="settings-assistant-data-tab">
    <div
      v-if="state === 'loading'"
      class="flex flex-col gap-3"
      data-test="settings-assistant-data-loading"
    >
      <OSkeleton type="rect" class="h-8 w-full max-w-120" />
      <OSkeleton type="text" class="w-1/2" />
    </div>
    <OEmptyState
      v-else-if="state === 'forbidden'"
      preset="no-access"
      size="block"
      hide-action
      :title="t('assistant.settings.forbidden')"
    />
    <OEmptyState
      v-else-if="state === 'error'"
      preset="load-error"
      size="block"
      data-test="settings-assistant-data-error"
      @action="refresh"
    />
    <OForm v-else :form="form" class="flex flex-col gap-5" data-test="settings-assistant-data-form">
      <p
        v-if="!levelsSupported"
        class="text-text-secondary text-sm"
        data-test="settings-assistant-data-notice"
      >
        {{ t("assistant.settings.data.notice") }}
      </p>
      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-end gap-2">
          <OFormToggleGroup
            name="data_sharing_level"
            :label="t('assistant.settings.data.level')"
            label-position="top"
            mobile-dropdown
            :disabled="readOnly"
            :aria-describedby="lineId"
            data-test="settings-assistant-data-level-group"
          >
            <OToggleGroupItem
              v-for="level in LEVELS"
              :key="level.value"
              :value="level.value"
              size="sm"
              :class="TOUCH_TARGET_CLASS"
              :data-test="`settings-assistant-data-level-${level.value}`"
              >{{ t(level.labelKey) }}</OToggleGroupItem
            >
          </OFormToggleGroup>
          <OPopover side="bottom" align="start" content-class="flex max-w-80 flex-col gap-2 p-3">
            <template #trigger>
              <AssistantIconButton
                :label="t('assistant.settings.data.about')"
                :icon="assistantGlyph.info"
                no-tooltip
                data-test="settings-assistant-data-about"
              />
            </template>
            <p class="text-text-heading text-sm font-semibold">
              {{ t("assistant.settings.data.about") }}
            </p>
            <p v-if="provider" class="text-text-body text-sm">
              {{ t("assistant.settings.data.aboutProvider", { provider: raw(provider) }) }}
            </p>
            <p v-if="redaction" class="text-text-body text-sm">
              {{ t("assistant.settings.data.aboutRedaction") }}
            </p>
          </OPopover>
        </div>
        <p :id="lineId" class="text-text-secondary text-xs">{{ levelLine }}</p>
      </div>
      <div
        v-if="!readOnly"
        class="bg-surface-base flex justify-end gap-2 max-md:sticky max-md:bottom-0 max-md:py-2"
      >
        <OButton
          variant="outline"
          size="sm-action"
          type="button"
          :class="TOUCH_TARGET_CLASS"
          :disabled="!dirty || submitting"
          data-test="settings-assistant-data-cancel"
          @click="form.reset(defaults)"
          >{{ t("assistant.settings.access.cancel") }}</OButton
        >
        <OButton
          ref="saveButton"
          variant="primary"
          size="sm-action"
          type="submit"
          :class="TOUCH_TARGET_CLASS"
          :loading="submitting"
          :disabled="!dirty || submitting"
          focusable-unavailable
          data-test="settings-assistant-data-save"
          >{{ t("assistant.settings.access.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, ref, useId, watch } from "vue";
import { z } from "zod";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { capabilitiesQuery } from "@/services/assistant.queries";
import { parseCapabilityStatus, type DataSharingLevel } from "@/services/assistant_settings";
import {
  assistantSettingsQuery,
  updateAssistantSettingsMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

import {
  readStateOf,
  useAssistantSettingsPage,
  useSettingsLeaveGuard,
} from "./useAssistantSettingsPage";

const LEVELS: { value: DataSharingLevel; labelKey: I18nKey; lineKey: I18nKey }[] = [
  {
    value: "schema",
    labelKey: "assistant.settings.data.levelSchema",
    lineKey: "assistant.settings.data.levelSchemaLine",
  },
  {
    value: "aggregates",
    labelKey: "assistant.settings.data.levelAggregates",
    lineKey: "assistant.settings.data.levelAggregatesLine",
  },
  {
    value: "raw",
    labelKey: "assistant.settings.data.levelRaw",
    lineKey: "assistant.settings.data.levelRawLine",
  },
];

const schema = z.object({ data_sharing_level: z.enum(["schema", "aggregates", "raw"]) });

type DataValues = z.infer<typeof schema>;

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();
const lineId = useId();
const saveButton = ref<InstanceType<typeof OButton> | null>(null);

const settings = useQuery(computed(() => assistantSettingsQuery(page.org.value)));
const capabilities = useQuery(
  computed(() => capabilitiesQuery(page.org.value, page.aiEnabled.value)),
);
const update = useMutation(() => updateAssistantSettingsMutation(page.org.value));

const state = computed(() => readStateOf(settings));
// The agent honours the level only where it reports a server-enforced policy.
const caps = computed(() => parseCapabilityStatus(capabilities.data.value));
const levelsSupported = computed(
  () => !!settings.data.value && caps.value?.policyEnforced === true,
);
const readOnly = computed(() => !levelsSupported.value || !page.isAdmin.value);
const provider = computed(() => caps.value?.provider ?? "");
const redaction = computed(() => caps.value?.redactionApplied === true);

const defaults = computed<DataValues>(() => ({
  data_sharing_level: levelsSupported.value
    ? (settings.data.value?.data_sharing_level ?? "raw")
    : "raw",
}));

const form = useOForm<DataValues>({ defaultValues: defaults.value, schema, onSubmit: save });
const level = form.useStore((s: { values: DataValues }) => s.values.data_sharing_level);
const pristine = form.useStore((s: { isDefaultValue: boolean }) => s.isDefaultValue);
const submitting = form.useStore((s: { isSubmitting: boolean }) => s.isSubmitting);
const dirty = computed(() => !pristine.value && !readOnly.value);

const levelLine = computed(() =>
  t(LEVELS.find((x) => x.value === level.value)?.lineKey ?? LEVELS[2].lineKey),
);

watch(defaults, (next) => {
  if (!dirty.value) form.reset(next);
});
watch(page.org, () => form.reset(defaults.value));

useSettingsLeaveGuard(page, () => dirty.value);

function refresh() {
  return Promise.all([settings.refetch(), capabilities.refetch()]);
}

async function save(values: DataValues) {
  if (!settings.data.value || readOnly.value) return;
  try {
    await update.mutateAsync({ data_sharing_level: values.data_sharing_level });
  } catch {
    (saveButton.value?.$el as HTMLElement | undefined)?.focus();
    return;
  }
  form.reset(values);
  toast({ variant: "success", message: t("assistant.settings.access.saved") });
}

defineExpose({ refresh });
</script>
