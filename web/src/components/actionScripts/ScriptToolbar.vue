<template>
  <!-- Inline form (no dialog): the Save button lives INSIDE the <OForm>, so it
       is `type="submit"` and Enter submits natively — no `form-id` needed. The
       OForm's <form> element carries the toolbar layout classes so the
       justify-between row is preserved. -->
  <OForm
    :form="form"
    v-slot="{ isSubmitting }"
    data-test="add-script-toolbar"
    class="pb-1.5 w-full flex justify-between items-center"
  >
    <div class="flex items-center">
      <div class="mr-2">
        <div
          data-test="add-script-back-btn"
          class="flex justify-center items-center cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="redirectToScripts"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
      </div>
      <div class="text-lg w-full mr-3">
        Add Action
      </div>
      <div>
        <div class="flex items-center">
          <OFormInput
            data-test="add-script-name-input"
            name="name"
            :label="t('actions.name')"
            required
            class="p-0 w-full"
            :readonly="disableName"
            :disabled="disableName"
            style="min-width: 300px"
          />
        </div>
      </div>
    </div>
    <div data-test="add-script-actions" class="flex items-center gap-2">
      <OButton
        data-test="add-script-fullscreen-btn"
        v-close-popup="true"
        variant="outline"
        size="sm"
        @click="handleFullScreen"
        ><OIcon name="fullscreen" size="sm" class="mr-1" />{{
          t("common.fullscreen")
        }}</OButton
      >
      <OButton
        data-test="add-script-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        :loading="isSubmitting"
        >{{ t("actions.save") }}</OButton
      >
      <OButton
        data-test="add-script-cancel-btn"
        variant="outline-destructive"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('cancel')"
        >{{ t("common.cancel") }}</OButton
      >
    </div>
  </OForm>
</template>
<script setup lang="ts">
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toggleFullscreen } from "@/utils/dom";
import {
  makeScriptToolbarSchema,
  type ScriptToolbarForm,
} from "./ScriptToolbar.schema";

const { t } = useI18n();

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  disableName: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["test", "save", "update:name", "back", "cancel"]);

// @submit fires ONLY once the Zod schema passes (name required + method-name
// regex), so emitting `save` here preserves the old contract — "emit save only
// after the form validates" — without a hand-rolled validate().
const onSubmit = (_value: ScriptToolbarForm) => {
  emit("save");
};

// ── Rule ③ OWNER pattern ─────────────────────────────────────────────────────
// This component OWNS the <OForm>, so it creates the form headlessly with
// useOForm and reads it reactively via form.useStore — NO `form.store.subscribe`
// mirror, NO parallel ref. The form is the single source of truth; the parent
// keeps its canonical copy via the `update:name` contract. Seeded from the
// parent-owned `name`; handed down via <OForm :form="form">.
const form = useOForm<ScriptToolbarForm>({
  defaultValues: { name: props.name ?? "" },
  schema: makeScriptToolbarSchema(t),
  onSubmit,
});

// Mirror the form-owned `name` OUT to the parent (update:name) — a one-way emit
// driven by the reactive form.useStore read (NOT store.subscribe). The guard
// prevents an emit/prop echo loop with the reverse watch below.
const formName = form.useStore((s: any) => s.values.name);
watch(formName, (v) => {
  // Emit the TRIMMED value — parity with the pre-migration `v-model.trim`, which
  // stripped surrounding whitespace before handing the name to the parent (the
  // canonical value owner). Schema `.trim()` only affects validation, not the
  // stored form value, so trim at the emit too.
  const next = ((v ?? "") as string).trim();
  if (next !== (props.name ?? "")) emit("update:name", next);
});

// Keep the form in sync when the parent changes `name` externally (e.g. async
// prefill). Watching the EXTERNAL source → setFieldValue is the sanctioned
// prefill path; `dontUpdateMeta` avoids marking the field touched/dirty (no
// premature re-validation / post-save flash).
watch(
  () => props.name,
  (v) => {
    if ((form.state.values?.name ?? "") !== (v ?? "")) {
      form.setFieldValue("name", v ?? "", { dontUpdateMeta: true });
    }
  },
);

const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToScripts = () => {
  emit("back");
};
</script>
