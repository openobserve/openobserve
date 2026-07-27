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
  <ODrawer
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="isEdit ? t('synthetics.locations.editTitle') : t('synthetics.locations.createTitle')"
    :primary-button-label="
      isEdit ? t('synthetics.locations.updateClose') : t('synthetics.locations.createClose')
    "
    :secondary-button-label="t('synthetics.locations.cancel')"
    form-id="synthetics-location-form"
    @click:secondary="handleClose"
    data-test="synthetics-location-form-drawer"
  >
    <OForm
      id="synthetics-location-form"
      ref="locationFormRef"
      :schema="locationFormSchema"
      :default-values="locationFormDefaults"
      @submit="saveLocation"
      class="flex flex-col gap-4"
    >
      <div class="flex flex-col gap-y-3">
        <OFormSelect
          name="provider"
          :label="t('synthetics.locations.provider')"
          :options="providerOptions"
          :placeholder="t('synthetics.locations.providerPlaceholder')"
          required
          data-test="synthetics-location-provider-select"
        />
        <OFormInput
          v-if="providerValue === 'custom'"
          name="customProvider"
          :label="t('synthetics.locations.customProviderLabel')"
          :placeholder="t('synthetics.locations.customProviderPlaceholder')"
          required
          data-test="synthetics-location-custom-provider-input"
        />
        <OFormInput
          name="region"
          :label="t('synthetics.locations.region')"
          :placeholder="t('synthetics.locations.regionPlaceholder')"
          required
          data-test="synthetics-location-region-input"
        />
        <OFormInput
          name="label"
          :label="t('synthetics.locations.label')"
          :placeholder="t('synthetics.locations.labelPlaceholder')"
          required
          data-test="synthetics-location-label-input"
        />
        <div class="flex flex-col gap-1">
          <label class="text-text-secondary text-sm font-medium">
            {{ t("synthetics.locations.locationId") }}
          </label>
          <div
            class="text-text-secondary rounded-default border-input-border bg-surface-subtle border px-3 py-2 text-sm"
          >
            {{ derivedId || "-" }}
          </div>
        </div>
        <OFormSwitch
          name="enabled"
          :label="t('synthetics.locations.enabled')"
          data-test="synthetics-location-enabled-toggle"
        />
      </div>
    </OForm>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import {
  makeSyntheticsLocationFormSchema,
  type SyntheticsLocationForm,
} from "./SyntheticsLocationsList.schema";

export default defineComponent({
  name: "SyntheticsLocationForm",
  emits: ["close", "update:list", "update:open"],
  props: {
    data: {
      type: Object,
      default: () => ({}),
    },
    isEdit: {
      type: Boolean,
      default: false,
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    ODrawer,
    OForm,
    OFormInput,
    OFormSelect,
    OFormSwitch,
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const locationFormRef = ref<any>(null);
    const locationFormSchema = makeSyntheticsLocationFormSchema(t);

    // Provider options for the select dropdown.
    const providerOptions = computed(() => [
      { label: "AWS", value: "aws" },
      { label: "GCP", value: "gcp" },
      { label: "Azure", value: "azure" },
      { label: t("synthetics.locations.providerOther"), value: "custom" },
    ]);

    // Edit-prefill defaults. OForm reads `:default-values` once at mount; ODrawer
    // (reka-ui `lazy`) unmounts/remounts its body on close/open so this re-seeds
    // each time the drawer opens.
    const locationFormDefaults = computed((): SyntheticsLocationForm => {
      if (props.isEdit) {
        const provider = (props.data as any)?.provider ?? "aws";
        const isCustom = !["aws", "gcp", "azure"].includes(provider);
        return {
          provider: isCustom ? "custom" : provider,
          customProvider: isCustom ? provider : "",
          region: (props.data as any)?.region ?? "",
          label: (props.data as any)?.label ?? "",
          enabled: (props.data as any)?.enabled ?? true,
        };
      }
      return { provider: "aws", customProvider: "", region: "", label: "", enabled: true };
    });

    // Live provider value from the form store (used to conditionally show the
    // customProvider input). Follows AddRegexPattern.vue's nested watch pattern.
    const providerValue = ref<string>(locationFormDefaults.value.provider);
    watch(
      () => locationFormRef.value,
      (formRef) => {
        const f = formRef?.form;
        if (!f) return;
        const liveProvider = f.useStore((s: any) => s.values.provider ?? "aws");
        watch(
          liveProvider,
          (v: string) => {
            providerValue.value = v;
          },
          { immediate: true },
        );
      },
      { immediate: true },
    );

    // Derived ID preview: `${provider}-${region}`. Updated reactively from the
    // form store via the nested watch pattern.
    const derivedId = ref<string>("");
    watch(
      () => locationFormRef.value,
      (formRef) => {
        const f = formRef?.form;
        if (!f) return;
        const liveProvider = f.useStore((s: any) => s.values.provider ?? "");
        const liveCustomProvider = f.useStore((s: any) => s.values.customProvider ?? "");
        const liveRegion = f.useStore((s: any) => s.values.region ?? "");
        watch(
          [liveProvider, liveCustomProvider, liveRegion],
          ([p, cp, r]: [string, string, string]) => {
            const provider = p === "custom" ? cp || "custom" : p;
            derivedId.value = provider && r ? `${provider}-${r}` : "";
          },
          { immediate: true },
        );
      },
      { immediate: true },
    );

    const saveLocation = async (value: SyntheticsLocationForm) => {
      const resolvedProvider =
        value.provider === "custom" ? (value.customProvider?.trim() ?? "custom") : value.provider;
      const id = `${resolvedProvider}-${value.region.trim()}`;
      try {
        const response = props.isEdit
          ? await syntheticsService.updateLocation(
              store.state.selectedOrganization.identifier,
              (props.data as any).id,
              { label: value.label.trim(), enabled: value.enabled },
            )
          : await syntheticsService.createLocation(store.state.selectedOrganization.identifier, {
              kind: "public",
              id,
              provider: resolvedProvider,
              region: value.region.trim(),
              label: value.label.trim(),
              enabled: value.enabled,
            });
        if (response.status == 200) {
          toast({
            message: props.isEdit
              ? t("synthetics.locations.updateSuccess")
              : t("synthetics.locations.createSuccess"),
            variant: "success",
          });
          emit("close");
          emit("update:list");
        }
      } catch (error) {
        const e = error as { response: { status: number; data?: { message?: string } } };
        if (e.response?.status != 403) {
          toast({
            message:
              e.response?.data?.message ||
              (props.isEdit
                ? t("synthetics.locations.updateFailed")
                : t("synthetics.locations.createFailed")),
            variant: "error",
          });
        }
      }
    };

    const handleClose = () => {
      emit("update:open", false);
      emit("close");
    };

    return {
      t,
      store,
      locationFormRef,
      locationFormSchema,
      locationFormDefaults,
      providerOptions,
      providerValue,
      derivedId,
      saveLocation,
      handleClose,
    };
  },
});
</script>
