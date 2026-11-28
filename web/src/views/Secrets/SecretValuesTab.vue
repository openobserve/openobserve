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
  <div class="flex flex-col gap-3" data-test="secret-values-tab">
    <div
      class="border-border-default divide-border-default rounded-surface flex flex-col divide-y border"
    >
      <SecretValueRow
        v-for="env in orderedEnvs"
        :key="env.env"
        :secret-id="detail.id"
        :kind="detail.kind"
        :env="env"
        :value="detail.value"
        :can-manage="canManage"
      />
      <SecretValueRow
        v-if="addingEnv"
        :key="`new-${addingEnv}`"
        :secret-id="detail.id"
        :kind="detail.kind"
        :env="newEnv(addingEnv)"
        start-editing
        @done="addingEnv = null"
      />
    </div>
    <OSelect
      v-if="canManage && missingEnvs.length && !addingEnv"
      class="max-w-60"
      :model-value="null"
      :label="t('secrets.values.addOverride')"
      :placeholder="t('secrets.values.pickEnv')"
      :options="missingEnvs.map((e) => ({ label: raw(e), value: e }))"
      data-test="secret-values-add-override"
      @update:model-value="(v: unknown) => (addingEnv = typeof v === 'string' ? v : null)"
    />
    <span class="text-text-secondary text-xs">{{ t("secrets.values.envHint") }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { secretEnvironmentsQuery } from "@/services/secrets.queries";
import { ORG_ENV_ID, type SecretDetail, type SecretEnvDetail } from "@/services/secrets";
import SecretValueRow from "./SecretValueRow.vue";

const props = defineProps<{ detail: SecretDetail }>();
const { t } = useI18nTyped();
const orgId = useOrgId();

const newEnv = (env: string): SecretEnvDetail => ({
  env,
  state: "unset",
  value_version: 0,
  updated_at: 0,
  updated_by: "",
});
// The server refuses value writes on a deleted secret with 409 secret_deleted.
const canManage = computed(
  () => props.detail.rights?.manage !== false && props.detail.state !== "deleted",
);
const environments = useQuery(() =>
  Object.assign(secretEnvironmentsQuery(orgId.value), {
    enabled: !!orgId.value && canManage.value,
  }),
);
const addingEnv = ref<string | null>(null);

const orderedEnvs = computed((): SecretEnvDetail[] => {
  const envs = props.detail.envs.filter((e) => e.state !== "deleted");
  const org = envs.find((e) => e.env === ORG_ENV_ID) ?? newEnv(ORG_ENV_ID);
  const rest = envs.filter((e) => e.env !== ORG_ENV_ID).sort((a, b) => a.env.localeCompare(b.env));
  return [org, ...rest];
});

/** Environments with no head row yet; any listed env (even `inherit`) has its own row. */
const missingEnvs = computed(() => {
  const listed = new Set(orderedEnvs.value.map((e) => e.env));
  return (environments.data.value ?? []).filter((e) => !listed.has(e)).sort();
});
</script>
