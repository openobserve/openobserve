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
  <ODrawer
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="isEdit ? t('synthetics.variables.editTitle') : t('synthetics.variables.createTitle')"
    :primary-button-label="isEdit ? t('common.save') : t('common.create')"
    :secondary-button-label="t('common.cancel')"
    form-id="synthetics-variable-form"
    @click:secondary="handleClose"
    data-test="synthetics-variable-form-drawer"
  >
    <OForm
      id="synthetics-variable-form"
      :schema="schema"
      :default-values="defaults"
      @submit="save"
      class="flex flex-col gap-4"
    >
      <!-- Scope is context, never a picker: you are creating where you stand. -->
      <OBanner variant="info" data-test="synthetics-variable-scope">
        {{
          environment
            ? t("synthetics.variables.scopeEnvironment", { env: environment })
            : t("synthetics.variables.scopeGlobal")
        }}
      </OBanner>

      <OFormInput
        name="name"
        :label="t('synthetics.variables.name')"
        :placeholder="t('synthetics.variables.namePlaceholder')"
        :disabled="isEdit"
        required
        data-test="synthetics-variable-name-input"
      />

      <OFormSelect
        name="kind"
        :label="t('synthetics.variables.kind')"
        :options="kindOptions"
        :disabled="!environment"
        :hint="!environment ? t('synthetics.variables.secretNeedsEnvironment') : undefined"
        data-test="synthetics-variable-kind-select"
      />

      <!-- A stored secret is never sent back, so the form shows presence and a
           Replace affordance rather than a populated field. -->
      <div v-if="isEdit && data?.kind === 'secret' && data?.has_value && !replacing">
        <p class="text-muted-foreground text-sm" data-test="synthetics-variable-value-set">
          {{ t("synthetics.variables.valueSet", { when: updatedRelative }) }}
        </p>
        <OButton
          variant="outline"
          size="sm"
          class="mt-2"
          data-test="synthetics-variable-replace-btn"
          @click="replacing = true"
          >{{ t("synthetics.variables.replace") }}</OButton
        >
      </div>
      <OFormInput
        v-else
        name="value"
        :type="kindValue === 'secret' ? 'password' : 'text'"
        :label="t('synthetics.variables.value')"
        :placeholder="t('synthetics.variables.valuePlaceholder')"
        data-test="synthetics-variable-value-input"
      />

      <OFormInput
        name="example"
        :label="t('synthetics.variables.example')"
        :placeholder="t('synthetics.variables.examplePlaceholder')"
        :hint="t('synthetics.variables.exampleHint')"
        data-test="synthetics-variable-example-input"
      />
      <OFormTextarea
        name="description"
        :label="t('synthetics.variables.description')"
        data-test="synthetics-variable-description-input"
      />
    </OForm>
  </ODrawer>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from "vue";
import type { PropType } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsVariablePayload } from "@/services/synthetics";
import type { SyntheticsVariable } from "@/types/synthetics";
import { makeSyntheticsVariableFormSchema } from "./SyntheticsVariableForm.schema";
import { relativeTime } from "./usage";

export default defineComponent({
  name: "SyntheticsVariableForm",
  components: {
    ODrawer,
    OForm,
    OFormInput,
    OFormSelect,
    OFormTextarea,
    OButton,
    OBanner,
  },
  emits: ["close", "update:list", "update:open"],
  props: {
    open: { type: Boolean, default: false },
    isEdit: { type: Boolean, default: false },
    data: { type: Object as PropType<SyntheticsVariable | null>, default: null },
    /** Environment NAME, or null for the unscoped tier. Fixed, never chosen here. */
    environment: { type: String as PropType<string | null>, default: null },
  },
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const replacing = ref(false);
    const kindValue = ref<"plain" | "secret">("plain");

    // A secret must carry an environment, so on the global tab the control is
    // disabled with the reason rather than failing validation after the fact.
    const kindOptions = computed(() =>
      props.environment
        ? [
            { label: t("synthetics.variables.kindPlain"), value: "plain" },
            { label: t("synthetics.variables.kindSecret"), value: "secret" },
          ]
        : [{ label: t("synthetics.variables.kindPlain"), value: "plain" }],
    );

    const hasStoredValue = computed(() => Boolean(props.isEdit && props.data?.has_value));
    const schema = computed(() =>
      makeSyntheticsVariableFormSchema(t as (_k: string) => string, hasStoredValue.value),
    );

    const defaults = computed(() => ({
      name: props.data?.name ?? "",
      kind: props.data?.kind ?? "plain",
      value: "",
      example: props.data?.example ?? "",
      description: props.data?.description ?? "",
    }));

    const updatedRelative = computed(() => relativeTime(props.data?.updated_at ?? 0));

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          replacing.value = false;
          kindValue.value = props.data?.kind ?? "plain";
        }
      },
    );

    function handleClose() {
      emit("update:open", false);
      emit("close");
    }

    async function save(values: Record<string, unknown>) {
      const org = store.state.selectedOrganization.identifier;
      const payload: SyntheticsVariablePayload = {
        name: String(values.name ?? ""),
        kind: (values.kind as "plain" | "secret") ?? "plain",
        example: String(values.example ?? ""),
        description: String(values.description ?? ""),
      };
      // Omitting `value` means "keep the stored one" — the only way to edit a
      // write-only secret's metadata without knowing its value.
      const typed = String(values.value ?? "");
      if (typed.length > 0 || !hasStoredValue.value) payload.value = typed;

      try {
        const id = props.data?.id ?? "";
        if (props.environment) {
          await (props.isEdit
            ? syntheticsService.updateEnvironmentVariable(org, props.environment, id, payload)
            : syntheticsService.createEnvironmentVariable(org, props.environment, payload));
        } else {
          await (props.isEdit
            ? syntheticsService.updateGlobalVariable(org, id, payload)
            : syntheticsService.createGlobalVariable(org, payload));
        }
        toast.success(
          props.isEdit ? t("synthetics.variables.updated") : t("synthetics.variables.created"),
        );
        emit("update:list");
        handleClose();
      } catch (error: any) {
        // The server's message names the conflict or the constraint, and is
        // written to be shown verbatim.
        toast.error(error?.response?.data?.message ?? t("synthetics.variables.saveFailed"));
      }
    }

    return {
      t,
      schema,
      defaults,
      kindOptions,
      kindValue,
      replacing,
      updatedRelative,
      handleClose,
      save,
    };
  },
});
</script>
