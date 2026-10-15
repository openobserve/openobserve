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
  <ODialog
    :open="open"
    size="sm"
    :title="title"
    :form-id="FORM_ID"
    :primary-button-label="t('rum.analytics.saved.submit')"
    :secondary-button-label="t('rum.analytics.saved.cancel')"
    data-test="rum-analytics-save-funnel-dialog"
    @update:open="(v) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-4">
      <OFormInput
        name="name"
        :label="t('rum.analytics.saved.name')"
        required
        data-test="rum-analytics-save-funnel-name"
      />
      <OFormTextarea
        v-if="mode !== 'rename'"
        name="description"
        :label="t('rum.analytics.saved.description')"
        :rows="3"
        data-test="rum-analytics-save-funnel-description"
      />
      <span v-if="mode !== 'rename'" class="text-text-secondary text-xs">{{
        t("rum.analytics.saved.snapshot")
      }}</span>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { z } from "zod";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { setServerFieldErrors, useOForm } from "@/lib/forms/Form/useOForm";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  nameFits,
} from "@/utils/rum/productAnalyticsModel";

export type SaveFunnelMode = "save" | "save-as" | "duplicate" | "rename";
/** `replaced`: the parent already swapped in another dialog, so this one must not close it. */
export type SaveFunnelOutcome = "saved" | "duplicate" | "failed" | "forbidden" | "replaced";
type SaveFunnelForm = { name: string; description: string };

const FORM_ID = "rum-analytics-save-funnel-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: SaveFunnelMode;
    initialName: string;
    initialDescription?: string;
    takenName: (name: string) => boolean;
    submit: (value: { name: string; description: string }) => Promise<SaveFunnelOutcome>;
  }>(),
  { initialDescription: "" },
);
const emit = defineEmits<{ "update:open": [boolean] }>();
const { t } = useI18nTyped();

const TITLES = {
  save: "rum.analytics.saved.saveTitle",
  "save-as": "rum.analytics.saved.saveAsTitle",
  duplicate: "rum.analytics.saved.duplicateTitle",
  rename: "rum.analytics.saved.renameTitle",
} as const satisfies Record<SaveFunnelMode, I18nKey>;

const title = computed(() => t(TITLES[props.mode]));

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, t("rum.analytics.saved.nameRequired"))
    .max(MAX_NAME_LENGTH, t("rum.analytics.saved.nameTooLong"))
    .refine(nameFits, t("rum.analytics.saved.nameKeyTooLong"))
    .refine((name) => !props.takenName(name), t("rum.analytics.saved.duplicateName")),
  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH, t("rum.analytics.saved.descriptionTooLong")),
});

const form = useOForm<SaveFunnelForm>({
  defaultValues: { name: props.initialName, description: props.initialDescription },
  schema,
  onSubmit: async (value) => {
    const outcome = await props.submit({
      name: value.name.trim(),
      description: value.description.trim(),
    });
    if (outcome === "saved" || outcome === "forbidden") emit("update:open", false);
    else if (outcome === "duplicate") {
      setServerFieldErrors(form, { name: t("rum.analytics.saved.duplicateName") });
    }
  },
});

const name = form.useStore((s: { values: SaveFunnelForm }) => s.values.name);
watch(name, () => setServerFieldErrors(form, {}));

watch(
  () => [props.open, props.initialName, props.initialDescription],
  () => {
    if (props.open) form.reset({ name: props.initialName, description: props.initialDescription });
  },
);
</script>
