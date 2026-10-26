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
  <div class="flex flex-col gap-4" data-test="fleet-component-properties">
    <div class="flex items-center gap-2.5">
      <span
        class="rounded-default grid h-9 w-9 shrink-0 place-items-center"
        :class="CHIP[component.kind]"
      >
        <OIcon :name="item?.icon ?? 'extension'" size="sm" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <OText variant="body-strong" truncate>{{ raw(item?.name ?? component.type) }}</OText>
        <OText variant="mono" truncate>{{ component.id }}</OText>
      </div>
      <OTag variant="default-soft" size="xs" :label="kindLabel" />
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="key in Object.keys(component.settings)"
        :key="key"
        class="flex items-end gap-1"
        :data-test="`fleet-component-properties-row-${key}`"
      >
        <OInput
          class="min-w-0 flex-1"
          :model-value="component.settings[key]"
          @update:model-value="(v) => emit('update', key, String(v ?? ''))"
          :label="raw(key)"
          size="sm"
          :data-test="`fleet-component-properties-field-${key}`"
        >
          <template v-if="component.settings[key].includes('${')" #tooltip>
            <OTooltip :content="t('fleet.editor.envReference')" />
          </template>
        </OInput>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :data-test="`fleet-component-properties-remove-${key}`"
          @click="emit('removeSetting', key)"
        >
          <OTooltip :content="t('fleet.editor.removeSetting')" />
        </OButton>
      </div>
      <OText v-if="component.base" variant="meta" data-test="fleet-component-properties-from-base">
        {{ t("fleet.editor.fromBaseHint") }}
      </OText>
      <OText v-else-if="!Object.keys(component.settings).length" variant="meta">{{
        t("fleet.editor.noSettings")
      }}</OText>
      <form
        v-if="!component.base"
        class="border-border-default flex flex-col gap-2 border-t pt-3"
        data-test="fleet-component-properties-add"
        @submit.prevent="addSetting"
      >
        <OInput
          v-model="newKey"
          :label="t('fleet.editor.settingKey')"
          size="sm"
          :placeholder="raw('headers.Authorization')"
          :help-text="t('fleet.editor.settingKeyHint')"
          :error="Boolean(newKeyError)"
          :error-message="newKeyError ?? undefined"
          data-test="fleet-component-properties-new-key"
        />
        <OInput
          v-model="newValue"
          :label="t('fleet.editor.settingValue')"
          size="sm"
          data-test="fleet-component-properties-new-value"
        />
        <OButton
          type="submit"
          class="self-start"
          variant="outline"
          size="sm"
          :disabled="!newKey.trim()"
          data-test="fleet-component-properties-add-submit"
        >
          {{ t("fleet.editor.addSetting") }}
        </OButton>
      </form>
    </div>

    <div v-if="pipelines.length" class="flex flex-col gap-1.5">
      <OText variant="label">{{ t("fleet.editor.usedIn") }}</OText>
      <div class="flex flex-wrap gap-1">
        <OTag
          v-for="p in pipelines"
          :key="p"
          :variant="p === pipelineId ? 'primary-soft' : 'default-soft'"
          :label="raw(p)"
        />
      </div>
    </div>

    <OButton
      class="self-start"
      variant="outline-destructive"
      size="sm"
      icon-left="delete"
      data-test="fleet-component-properties-remove"
      @click="emit('remove')"
    >
      {{
        pipelineId
          ? t("fleet.editor.removeFromPipeline", { pipeline: raw(pipelineId) })
          : t("fleet.editor.remove")
      }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { catalogFor, type EditorComponent, type EditorKind } from "./editorGraph";

const props = defineProps<{
  component: EditorComponent;
  pipelines: string[];
  pipelineId: string | null;
}>();
const emit = defineEmits<{
  remove: [];
  update: [key: string, value: string];
  removeSetting: [key: string];
}>();

const { t } = useI18nTyped();

const item = computed(() => catalogFor(props.component));

const CHIP: Record<EditorKind, string> = {
  receiver: "bg-icon-chip-info-bg text-icon-chip-info-text",
  processor: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  exporter: "bg-icon-chip-success-bg text-icon-chip-success-text",
  extension: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
};

const newKey = ref("");
const newValue = ref("");

// Dotted path with optional `[index]` segments, the shape `editorGraph` nests back into YAML.
const SETTING_KEY = /^[\w-]+(\[\d+\])*(\.[\w-]+(\[\d+\])*)*$/;

const newKeyError = computed(() => {
  const key = newKey.value.trim();
  if (!key) return null;
  if (!SETTING_KEY.test(key)) return t("fleet.editor.settingInvalid");
  return key in props.component.settings ? t("fleet.editor.settingExists") : null;
});

function addSetting() {
  const key = newKey.value.trim();
  if (!key || newKeyError.value) return;
  emit("update", key, newValue.value);
  newKey.value = "";
  newValue.value = "";
}

const kindLabel = computed(
  () =>
    ({
      receiver: t("fleet.editor.receiver"),
      processor: t("fleet.editor.processor"),
      exporter: t("fleet.editor.exporter"),
      extension: t("fleet.editor.extension"),
    })[props.component.kind],
);
</script>
