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
  <OForm
    v-slot="{ isSubmitting }"
    class="flex flex-col gap-5"
    :schema="schema"
    :default-values="tokenDefaults()"
    data-test="fleet-token-form"
    @submit="submitToken"
  >
    <OFormInput
      name="name"
      :label="t('fleet.common.name')"
      required
      data-test="fleet-token-form-name"
    />
    <OFormSelect
      name="expiry"
      :label="t('fleet.enrollment.expires')"
      :options="expiryOptions"
      data-test="fleet-token-form-expiry"
    />
    <OFormInput
      name="maxUses"
      type="number"
      :label="t('fleet.enrollment.maxUses')"
      :help-text="t('fleet.enrollment.maxUsesHelp')"
      data-test="fleet-token-form-max"
    />
    <div>
      <OButton
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSubmitting"
        data-test="fleet-token-form-submit"
      >
        {{ t("fleet.common.create") }}
      </OButton>
    </div>
  </OForm>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { createFleetTokenMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { makeTokenSchema, tokenDefaults, type TokenForm } from "./FleetTokenForm.schema";
import { holdTokenSecret, secretsEpoch } from "./fleetTokenSecrets";
import { serverMessage } from "./useFleetApi";

const props = defineProps<{
  fleetId: string;
  /** A callback, not an emit: Vue drops emits after unmount, and the refreshed token list can replace the form first. */
  onCreated?: (token: { id: string; token: string }) => void;
}>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const schema = makeTokenSchema(t);
const createToken = useMutation(() => createFleetTokenMutation(orgId.value));

const expiryOptions = computed(() => [
  { label: t("fleet.enrollment.days", { count: 7 }), value: "7" },
  { label: t("fleet.enrollment.days", { count: 30 }), value: "30" },
  { label: t("fleet.enrollment.days", { count: 90 }), value: "90" },
  { label: t("fleet.enrollment.never"), value: "never" },
]);

async function submitToken(value: TokenForm) {
  const org = orgId.value;
  const fleet = props.fleetId;
  const epoch = secretsEpoch();
  try {
    const res = await createToken.mutateAsync({
      name: value.name.trim(),
      expires_in_days: value.expiry === "never" ? null : Number(value.expiry),
      max_uses: value.maxUses === "" || value.maxUses == null ? null : Number(value.maxUses),
      fleet,
    });
    // An org switch or logout during the request bumps the epoch, so a late plaintext is dropped.
    const held = orgId.value === org && holdTokenSecret(org, res.id, res.token, epoch);
    // Never into a fleet the user has since left.
    if (held && props.fleetId === fleet) props.onCreated?.({ id: res.id, token: res.token });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  } finally {
    // The mutation's own state carries the plaintext.
    createToken.reset();
  }
}
</script>
