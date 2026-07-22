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
  <div class="step-deduplication w-full h-full overflow-auto mx-auto">
    <!-- DESCENDANT step (Rule ③): the AddAlert orchestrator owns the ONE <OForm>
         and provides FORM_CONTEXT_KEY. The fields below bind by nested `name=`
         (deduplication.fingerprint_fields / .time_window_minutes) into that
         form; flushDedup writes the derived `enabled` + sanitized time window
         back into it (payload parity). -->
    <div>
      <div
        class="step-content rounded-default min-h-full bg-surface-overlay border border-border-default"
      >
        <div
          class="section-header flex items-center gap-0 py-2.5 px-3 border-b border-border-default"
        >
          <div
            class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent"
          />
          <span class="section-header-title text-compact font-semibold text-text-heading">{{
            t("alerts.steps.deduplication")
          }}</span>
        </div>
        <div class="px-3 py-2">
          <!-- Fingerprint Fields -->
          <div class="mb-4">
            <div class="font-semibold pb-2 flex items-center">
              {{ t("alerts.deduplication.fingerprintFields") }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer">
                <OTooltip
                  :content="t('alerts.deduplication.fingerprintFieldsTooltip')"
                  side="right"
                />
              </OIcon>
            </div>
            <div class="text-sm mb-2 text-text-secondary">
              {{ t("alerts.deduplication.fingerprintFieldsHint") }}
            </div>
            <div class="relative">
              <OFormSelect
                name="deduplication.fingerprint_fields"
                :options="props.columns || []"
                multiple
                creatable
                data-test="alert-dedup-fingerprint-fields"
                class="max-w-150 min-w-75"
                :helpText="t('alerts.deduplication.fingerprintFieldsHelp')"
                @update:model-value="onFingerprintChange"
                @create="addFingerprintField"
              />
              <OTooltip
                v-if="fingerprintFields?.length > 0"
                :content="fingerprintFields.join(', ')"
                max-width="400px"
              />
            </div>
          </div>

          <!-- Time Window -->
          <div class="mb-4">
            <div class="font-semibold pb-2 flex items-center">
              {{ t("alerts.deduplication.timeWindow") }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer">
                <OTooltip :content="t('alerts.deduplication.timeWindowTooltip')" side="right" />
              </OIcon>
            </div>
            <div class="text-sm mb-2 text-text-secondary">
              {{ t("alerts.deduplication.timeWindowHint") }}
            </div>
            <div class="flex items-center">
              <div class="w-52.5 ml-0">
                <OFormInput
                  name="deduplication.time_window_minutes"
                  type="number"
                  min="1"
                  data-test="alert-dedup-time-window"
                  :placeholder="t('alerts.placeholders.autoUsesCheckInterval')"
                  @update:model-value="onTimeWindowChange"
                />
              </div>
              <div
                style="
                  min-width: 90px;
                  margin-left: 0 !important;
                  height: 28px;
                  font-weight: normal;
                "
                class="flex justify-center items-center bg-surface-subtle"
              >
                {{ t("alerts.minutes") }}
              </div>
            </div>
          </div>
        </div>
        <!-- end px-3 py-2 -->
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, type PropType } from "vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

/** number | undefined — "" and non-numeric become undefined (payload parity). */
const sanitizeTimeWindow = (val: any): number | undefined => {
  if (val == null || val === "") return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
};

export default defineComponent({
  name: "Step5Deduplication",
  components: { OIcon, OFormInput, OFormSelect, OTooltip },
  props: {
    deduplication: {
      type: Object as PropType<any>,
      default: () => ({
        enabled: true,
        fingerprint_fields: [],
        time_window_minutes: undefined,
      }),
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: ["update:deduplication"],
  setup(props) {
    const { t } = useI18n();
    const store = useStore();

    // DESCENDANT step (Rule ③): the AddAlert orchestrator provides
    // FORM_CONTEXT_KEY — the ONE form the fields bind into by nested `name=`.
    const form: any = inject(FORM_CONTEXT_KEY, null);

    // Reactive view of the selected fingerprint fields (tooltip + enabled derive).
    const fingerprintFields = form.useStore(
      (s: any) => (s.values?.deduplication?.fingerprint_fields ?? []) as string[],
    );

    // ── flushDedup — the single derive/sanitize step. Deferred to a microtask
    //    so it runs AFTER the OForm* field.handleChange has stored the raw value
    //    (their handler order is not guaranteed), making it fully
    //    order-independent. It derives `enabled` (fingerprint_fields.length > 0)
    //    and sanitizes `time_window_minutes` to number|undefined, writing both
    //    back into the ONE form so getAlertPayload (which reads raw form
    //    values) keeps payload parity. ─────────────────────────────────────────
    const flushDedup = () => {
      Promise.resolve().then(() => {
        const d = (form.getFieldValue("deduplication") as any) ?? {};
        const fields: string[] = Array.isArray(d.fingerprint_fields) ? d.fingerprint_fields : [];
        const enabled = fields.length > 0;
        const cleanWindow = sanitizeTimeWindow(d.time_window_minutes);
        if (d.enabled !== enabled) form.setFieldValue("deduplication.enabled", enabled);
        if (cleanWindow !== d.time_window_minutes)
          form.setFieldValue("deduplication.time_window_minutes", cleanWindow);
      });
    };

    const onFingerprintChange = () => flushDedup();
    const onTimeWindowChange = () => flushDedup();

    // @create only NOTIFIES (OSelect does not add the created term to the model),
    // so add it here — matching the pre-migration addFingerprintField.
    const addFingerprintField = (value: string) => {
      const current = (form.getFieldValue("deduplication.fingerprint_fields") as string[]) ?? [];
      if (!current.includes(value)) {
        form.setFieldValue("deduplication.fingerprint_fields", [...current, value]);
        flushDedup();
      }
    };

    return {
      t,
      store,
      props,
      fingerprintFields,
      onFingerprintChange,
      onTimeWindowChange,
      addFingerprintField,
    };
  },
});
</script>
