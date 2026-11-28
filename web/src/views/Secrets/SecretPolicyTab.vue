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
  <OForm :form="form" class="flex flex-col gap-5" data-test="secret-policy-tab">
    <div
      class="border-border-default divide-border-default rounded-surface flex flex-col divide-y border px-4"
    >
      <div
        v-for="type in CONSUMER_TYPES"
        :key="type"
        class="flex flex-wrap items-start gap-3 py-3"
        :data-test="`secret-policy-type-${type}`"
      >
        <OFormCheckbox
          :name="`consumers.${type}.enabled`"
          class="min-w-48"
          :disabled="!canSave"
          :label="consumerTypeLabel(t, type)"
          :data-test="`secret-policy-type-${type}-enabled`"
        />
        <template v-if="consumers[type].enabled">
          <OFormSelect
            :name="`consumers.${type}.mode`"
            size="sm"
            class="w-52"
            :disabled="!canSave"
            :options="modeOptions"
            :data-test="`secret-policy-type-${type}-mode`"
          />
          <OFormTagInput
            v-if="consumers[type].mode === 'selected'"
            :name="`consumers.${type}.ids`"
            class="min-w-0 flex-1"
            :disabled="!canSave"
            :placeholder="t('secrets.policy.consumerIds')"
            :data-test="`secret-policy-type-${type}-ids`"
          />
        </template>
      </div>
    </div>

    <template v-if="detail.kind === 'secret'">
      <div class="flex flex-col gap-3">
        <OFormRadioGroup
          name="pin_mode"
          :label="t('secrets.policy.hostPin')"
          :disabled="!canSave"
          required
          data-test="secret-policy-pin-mode"
        >
          <ORadio
            value="hosts"
            data-test="secret-policy-pin-mode-hosts"
            data-test-value="hosts"
            :label="t('secrets.policy.onlyTheseHosts')"
          />
          <ORadio
            value="any"
            data-test="secret-policy-pin-mode-any"
            data-test-value="any"
            :label="t('secrets.policy.allowAnyHost')"
          />
        </OFormRadioGroup>
        <template v-if="pinMode === 'hosts'">
          <OFormTagInput
            name="hosts"
            :disabled="!canSave"
            :placeholder="t('secrets.policy.hostsPlaceholder')"
            data-test="secret-policy-hosts"
          />
          <span class="text-text-secondary text-xs">{{ t("secrets.policy.hostsHint") }}</span>
        </template>
        <template v-else>
          <OFormInput
            name="pin_override_reason"
            :disabled="!canSave"
            required
            :label="t('secrets.policy.reason')"
            :help-text="t('secrets.policy.reasonHint')"
            data-test="secret-policy-pin-reason"
          />
          <OBanner
            variant="error"
            icon="warning"
            :content="t('secrets.policy.anyHostWarning')"
            data-test="secret-policy-any-host-warning"
          />
        </template>
        <span class="text-text-secondary text-xs">{{ t("secrets.policy.redirectsRefused") }}</span>
      </div>

      <div class="flex flex-col gap-3">
        <OFormSwitch
          name="private_locations"
          :disabled="!canSave"
          :label="t('secrets.policy.privateLocations')"
          data-test="secret-policy-private-locations"
        />
        <span v-if="detail.private_locations === 'legacy'" class="text-text-secondary text-xs">
          {{ t("secrets.policy.privateLocationsLegacy") }}
        </span>
        <OFormInput
          v-if="privateLocations"
          name="private_locations_reason"
          :disabled="!canSave"
          required
          :label="t('secrets.policy.reason')"
          :help-text="t('secrets.policy.privateLocationsHint')"
          data-test="secret-policy-private-locations-reason"
        />
      </div>
    </template>

    <OBanner
      v-if="nowFailing.length"
      variant="warning"
      icon="warning"
      :content="
        t(
          'secrets.policy.nowFailing',
          { count: nowFailing.length, names: nowFailing.map((f) => f.consumer_name).join(', ') },
          nowFailing.length,
        )
      "
      data-test="secret-policy-now-failing"
    />

    <div class="flex items-center justify-end gap-2">
      <span v-if="!canSave" class="text-text-secondary me-auto text-xs">{{
        t("secrets.policy.needsManageAccess")
      }}</span>
      <OButton
        v-if="canSave"
        variant="outline"
        size="sm-action"
        data-test="secret-policy-cancel"
        @click="reset"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        v-if="canSave"
        variant="primary"
        size="sm-action"
        type="submit"
        data-test="secret-policy-save"
      >
        {{ nowFailing.length ? t("secrets.policy.saveAnyway") : t("common.save") }}
      </OButton>
    </div>
  </OForm>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { CONSUMER_TYPES, type NowFailing, type SecretDetail } from "@/services/secrets";
import { dryRunSecretPolicyMutation, putSecretPolicyMutation } from "@/services/secrets.queries";
import { consumerTypeLabel } from "./secretBadges";
import { secretErrorText } from "./secretErrors";
import {
  buildPolicyRequest,
  makeSecretPolicySchema,
  secretPolicyDefaults,
  type SecretPolicyForm,
} from "./SecretPolicy.schema";

const props = defineProps<{ detail: SecretDetail }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const nowFailing = ref<NowFailing[]>([]);
// The policy PUT needs manage access; an older server sends no rights and decides itself.
const canSave = computed(() => props.detail.rights?.manage_access !== false);
// Set once the dry run's warning was shown, so the next Save writes.
const warned = ref(false);

const dryRun = useMutation(() => dryRunSecretPolicyMutation(orgId.value, props.detail.id));
const put = useMutation(() => putSecretPolicyMutation(orgId.value, props.detail.id));

const modeOptions = [
  { label: t("secrets.policy.modeAll"), value: "all" },
  { label: t("secrets.policy.modeSelected"), value: "selected" },
];

const onSubmit = async (values: SecretPolicyForm) => {
  const body = buildPolicyRequest(values, props.detail);
  try {
    if (!warned.value) {
      const res = await dryRun.mutateAsync(body);
      nowFailing.value = res.data?.now_failing ?? [];
      if (nowFailing.value.length) {
        warned.value = true;
        return;
      }
    }
    await put.mutateAsync(body);
    nowFailing.value = [];
    warned.value = false;
    toast({ variant: "success", message: t("secrets.policy.saved") });
  } catch (e) {
    toast({ variant: "error", message: secretErrorText(t, e, t("secrets.policy.saveFailed")) });
  }
};

const form = useOForm<SecretPolicyForm>({
  defaultValues: secretPolicyDefaults(props.detail),
  schema: makeSecretPolicySchema(t, props.detail.kind),
  onSubmit,
});

const consumers = form.useStore((s) => s.values.consumers);
const pinMode = form.useStore((s) => s.values.pin_mode);
const privateLocations = form.useStore((s) => s.values.private_locations);

const allValues = form.useStore((s) => s.values);
watch(
  allValues,
  () => {
    warned.value = false;
    nowFailing.value = [];
  },
  { deep: true },
);

watch(
  () => props.detail.policy_rev,
  () => {
    const defaults = secretPolicyDefaults(props.detail);
    if (props.detail.pin_mode === "any" && defaults.hosts.length === 0) {
      defaults.hosts = [...form.state.values.hosts];
    }
    form.reset(defaults);
    nowFailing.value = [];
    warned.value = false;
  },
);

const reset = () => {
  form.reset(secretPolicyDefaults(props.detail));
  nowFailing.value = [];
  warned.value = false;
};

defineExpose({ form });
</script>
