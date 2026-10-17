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
      <OInput
        v-for="key in Object.keys(component.settings)"
        :key="key"
        :model-value="component.settings[key]"
        @update:model-value="(v) => emit('update', key, String(v ?? ''))"
        :label="raw(key)"
        size="sm"
        :help-text="
          component.settings[key].includes('${') ? t('fleet.editor.envReference') : undefined
        "
        :data-test="`fleet-component-properties-field-${key}`"
      />
      <OText v-if="component.base" variant="meta" data-test="fleet-component-properties-from-base">
        {{ t("fleet.editor.fromBaseHint") }}
      </OText>
      <OText v-else-if="!Object.keys(component.settings).length" variant="meta">{{
        t("fleet.editor.noSettings")
      }}</OText>
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
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { catalogFor, type EditorComponent, type EditorKind } from "./editorGraph";

const props = defineProps<{
  component: EditorComponent;
  pipelines: string[];
  pipelineId: string | null;
}>();
const emit = defineEmits<{ remove: []; update: [key: string, value: string] }>();

const { t } = useI18nTyped();

const item = computed(() => catalogFor(props.component));

const CHIP: Record<EditorKind, string> = {
  receiver: "bg-icon-chip-info-bg text-icon-chip-info-text",
  processor: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  exporter: "bg-icon-chip-success-bg text-icon-chip-success-text",
  extension: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
};

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
