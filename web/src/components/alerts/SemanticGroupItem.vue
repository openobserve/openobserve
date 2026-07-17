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
  <div class="semantic-group-item p-3 mb-2 rounded-lg transition-all duration-200 w-full max-w-full bg-(--o2-card-bg) border border-(--o2-border-color,rgba(0,0,0,0.12))">
    <OForm :form="form">
      <div class="grid grid-cols-[200px_1fr_auto] gap-4 items-start w-full overflow-hidden">
        <!-- Left Column: Display Name only (ID is internal/read-only) -->
        <div class="flex flex-col gap-1 min-w-0 justify-center">
          <div class="input-wrapper">
            <OFormInput
              name="display"
              data-test="semantic-group-display-input"
              :label="t('common.name')"
              required
              class="showLabelOnTop"
              @blur="handleDisplayBlur"
            />
          </div>
          <!-- Show ID as read-only caption for existing groups -->
          <div v-if="currentId" class="text-xs text-gray-400">
            {{ t("common.id") }}: {{ currentId }}
          </div>
          <OFormSwitch
            name="is_workload_type"
            :label="t('correlation.isWorkloadType')"
            class="mt-1"
          >
            <OTooltip :content="t('correlation.isWorkloadTypeTooltip')" />
          </OFormSwitch>
        </div>

        <!-- Right Column: Field Names spanning both rows -->
        <div class="flex flex-col h-full min-w-0 overflow-hidden">
          <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
            <OFormTagInput
              name="fields"
              :placeholder="t('correlation.fieldNamePlaceholder')"
            />
          </div>
        </div>


        <!-- Actions Column: Delete -->
        <div class="flex flex-col justify-between min-h-full">
          <div class="flex justify-end">
            <OButton
              data-test="semantic-group-remove-group-btn"
              type="button"
              :variant="isProtected ? 'ghost-muted' : 'ghost-destructive'"
              size="icon-circle-sm"
              :disabled="isProtected"
              @click="!isProtected && emit('delete')"
            >
              <OIcon name="delete" size="sm" />
              <OTooltip :content="isProtected ? t('correlation.serviceGroupProtected') : t('correlation.removeSemanticGroup')" />
            </OButton>
          </div>
        </div>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormTagInput from "./OFormTagInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeSemanticGroupItemSchema,
  semanticGroupItemDefaults,
  type SemanticGroupItemForm,
} from "./SemanticGroupItem.schema";

const { t } = useI18n();

interface SemanticGroup {
  id: string;
  display: string;
  fields: string[];
  group?: string;
  is_workload_type?: boolean;
}

interface Props {
  group: SemanticGroup;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update", group: SemanticGroup): void;
  (e: "delete"): void;
}>();

const isProtected = computed(() => props.group.id === "service");

// `id` is a slugify side-effect of `display` (+ category), NOT a form field.
const currentId = ref<string>(props.group.id);

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Generate ID as "{category-slug}-{display-slug}" for new groups
const generateIdFromDisplay = (display: string): string => {
  const displaySlug = slugify(display);
  const categorySlug = slugify(props.group.group || "");
  return categorySlug ? `${categorySlug}-${displaySlug}` : displaySlug;
};

// This row OWNS its <OForm> (Rule ③ owner pattern): it must read form state
// reactively to re-emit the parent-collected "update" on every field change and
// to run the id-generation side-effect. Wire the save into `onSubmit` so a
// programmatic submit (or Enter inside the inline form) emits the assembled
// group only when the schema passes.
const form = useOForm<SemanticGroupItemForm>({
  defaultValues: semanticGroupItemDefaults(props.group),
  schema: makeSemanticGroupItemSchema(t),
  // emitIfChanged, not emitUpdate: handleDisplayBlur submits on every blur to
  // paint the required error, and the values watcher has usually emitted already
  // — so an unconditional emit would fire a redundant "update" per blur.
  onSubmit: () => emitIfChanged(),
});

// Assemble the emitted group from the outside-form context (id + category from
// the prop) merged with the form-owned values — explicit keys, no schema leak.
const buildGroup = (): SemanticGroup => {
  const values = form.state.values as SemanticGroupItemForm;
  return {
    ...props.group,
    id: currentId.value,
    display: values.display ?? "",
    is_workload_type: values.is_workload_type ?? false,
    fields: values.fields ? [...values.fields] : [],
  };
};

// Guard against redundant / self-echo emits (the parent round-trips the group
// back into the `group` prop after each emit) so the empty-form submit test can
// assert "not fired" and typing doesn't loop.
const lastEmitted = ref<string>(JSON.stringify(buildGroup()));

const emitUpdate = () => {
  const group = buildGroup();
  lastEmitted.value = JSON.stringify(group);
  emit("update", group);
};

const emitIfChanged = () => {
  if (JSON.stringify(buildGroup()) !== lastEmitted.value) {
    emitUpdate();
  }
};

// Re-emit "update" on every field change (parent collects rows live — Rule ④
// event parity with the pre-migration per-field @update handlers).
const formValues = form.useStore((s: any) => s.values);
watch(formValues, () => emitIfChanged(), { deep: true });

// Regenerate the id from the display, then surface the schema's "Name is
// required" on the field — pre-migration `handleDisplayBlur` did BOTH.
//
// The submit is what paints it: useOForm wires revalidateLogic({mode:"submit"}),
// so nothing validates until a first submit, and this inline row has no submit
// button (its only consumer wires @update/@delete). Without this call the rule
// exists but can never fire. `modeAfterSubmission:"change"` then re-validates on
// every keystroke, which is what clears the message as the user types — matching
// the old `handleDisplayChange` reset.
const handleDisplayBlur = () => {
  const display = (form.state.values as SemanticGroupItemForm).display;
  if (display) {
    const newId = generateIdFromDisplay(display);
    if (currentId.value !== newId) {
      currentId.value = newId;
      emitUpdate();
    }
  }
  form.handleSubmit();
};

// External changes to the group prop (import merge, category switch) reset the
// form; a self-echo (the parent replaying our own emit) is skipped so it never
// resets mid-edit (which would flash/jump). Only the form-owned fields + id are
// compared — the `group` category is not a form field.
watch(
  () => props.group,
  (newGroup) => {
    const values = form.state.values as SemanticGroupItemForm;
    const incoming = JSON.stringify({
      id: newGroup.id ?? "",
      display: newGroup.display ?? "",
      is_workload_type: newGroup.is_workload_type ?? false,
      fields: newGroup.fields ?? [],
    });
    const current = JSON.stringify({
      id: currentId.value,
      display: values.display ?? "",
      is_workload_type: values.is_workload_type ?? false,
      fields: values.fields ?? [],
    });
    if (incoming !== current) {
      currentId.value = newGroup.id;
      form.reset(semanticGroupItemDefaults(newGroup));
      // Rebaseline so the deep values-watch that follows the reset does NOT
      // re-emit "update" (the original prop-sync did not emit either).
      lastEmitted.value = JSON.stringify(buildGroup());
    }
  },
  { deep: true },
);
</script>
