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
      ref="formRef"
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
      <OBanner v-if="!environment" variant="warning" data-test="synthetics-variable-global-warning">
        {{ t("synthetics.variables.globalReachesProduction") }}
      </OBanner>

      <OFormInput
        name="name"
        :label="t('synthetics.variables.name')"
        :placeholder="t('synthetics.variables.namePlaceholder')"
        :disabled="isEdit"
        required
        data-test="synthetics-variable-name-input"
      />

      <div class="flex flex-col gap-1">
        <OFormSelect
          name="kind"
          :label="t('synthetics.variables.kind')"
          :options="kindOptions"
          :disabled="isEdit || !environment"
          data-test="synthetics-variable-kind-select"
          @update:model-value="onKindChange"
        />
        <p
          v-if="!environment"
          class="text-muted-foreground text-sm"
          data-test="synthetics-variable-kind-caption"
        >
          {{ t("synthetics.variables.secretNeedsEnvironment") }}
        </p>
      </div>

      <div v-if="isEdit && data?.kind === 'secret' && data?.has_value && !replacing">
        <p class="text-muted-foreground text-sm" data-test="synthetics-variable-value-set">
          {{ t("synthetics.variables.valueSet", { when: updatedRelative }) }}
        </p>
        <p class="text-muted-foreground text-sm" data-test="synthetics-variable-secret-write-only">
          {{ t("synthetics.variables.secretWriteOnly") }}
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
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsVariablePayload } from "@/services/synthetics";
import type { SyntheticsVariable } from "@/types/synthetics";
import { makeSyntheticsVariableFormSchema } from "./SyntheticsVariableForm.schema";
import { relativeTime } from "./usage";
import { serverMessage } from "./serverMessage";

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
    otherTierNames: {
      type: Object as PropType<Record<string, string[]>>,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const { confirm } = useConfirmDialog();
    const formRef = ref<InstanceType<typeof OForm> | null>(null);
    const replacing = ref(false);
    const kindValue = ref<"plain" | "secret">("plain");

    // Global reads are open to everyone, so the server refuses a secret there.
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
      value: props.data?.kind === "plain" ? (props.data.value ?? "") : "",
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

    function onKindChange(kind: unknown) {
      kindValue.value = kind === "secret" ? "secret" : "plain";
    }

    function handleClose() {
      emit("update:open", false);
      emit("close");
    }

    /** True once the author has seen what the save shadows — or when it shadows nothing. */
    async function acknowledgeShadow(name: string): Promise<boolean> {
      const envs = props.otherTierNames[name];
      if (envs === undefined) return true;
      const original = (props.data?.name ?? "").trim();
      if (props.isEdit && name === original) return true;
      return confirm(
        props.environment
          ? {
              title: t("synthetics.variables.shadowGlobalTitle"),
              message: t("synthetics.variables.shadowGlobalMessage", {
                name,
                env: props.environment,
              }),
            }
          : {
              title: t("synthetics.variables.shadowedGlobalTitle"),
              message: t("synthetics.variables.shadowedGlobalMessage", {
                name,
                envs: envs.join(", "),
              }),
            },
      );
    }

    async function save(values: Record<string, unknown>) {
      const org = store.state.selectedOrganization.identifier;
      const name = String(values.name ?? "").trim();
      if (!(await acknowledgeShadow(name))) return;
      const payload: SyntheticsVariablePayload = {
        name,
        kind: (values.kind as "plain" | "secret") ?? "plain",
        example: String(values.example ?? ""),
        description: String(values.description ?? ""),
      };
      const typed = String(values.value ?? "");
      // Only a secret's value is unknown to the form, so only a secret may omit it to keep it.
      if (payload.kind === "plain" || typed.length > 0 || !hasStoredValue.value) {
        payload.value = typed;
      }

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
        emit("update:list");
        handleClose();
        toast({
          variant: "success",
          message: props.isEdit
            ? t("synthetics.variables.updated")
            : t("synthetics.variables.created", { name }),
        });
      } catch (error: unknown) {
        toast({
          variant: "error",
          message: serverMessage(error) ?? t("synthetics.variables.saveFailed"),
        });
      }
    }

    return {
      t,
      formRef,
      schema,
      defaults,
      kindOptions,
      kindValue,
      replacing,
      updatedRelative,
      handleClose,
      onKindChange,
      save,
    };
  },
});
</script>
