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

<!-- Connect or edit one external store (X2–X4, X8, X9). Static credentials only until V15. -->
<template>
  <ODrawer
    :open="!!kind"
    size="lg"
    form-id="secret-backend-form"
    :title="title"
    :secondary-button-label="t('common.close')"
    :primary-button-label="t('common.save')"
    primary-button-data-test="secret-backend-save"
    data-test="secret-backend-drawer"
    @update:open="(v: boolean) => !v && emit('close')"
    @click:secondary="emit('close')"
  >
    <OForm
      v-if="kind"
      ref="formRef"
      id="secret-backend-form"
      :key="`${kind}-${current?.id ?? 'new'}`"
      :schema="makeBackendSchema(t, kind, credentialKept)"
      :default-values="backendDefaults(current)"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        required
        autocomplete="off"
        :label="t('secrets.backends.form.name')"
        data-test="secret-backend-name"
      />

      <div class="flex flex-col gap-1" data-test="secret-backend-sign-in">
        <span class="text-text-heading text-sm font-medium">{{
          t("secrets.backends.form.signIn")
        }}</span>
        <div class="flex items-center gap-2">
          <span class="text-text-body text-sm">{{ signInLabel }}</span>
          <OTag
            v-if="authMode === 'static'"
            size="xs"
            variant="warning-soft"
            icon=""
            :label="t('secrets.backends.staticBadge')"
            data-test="secret-backend-static-badge"
          />
        </div>
      </div>

      <template v-if="kind === 'aws_sm'">
        <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <OFormSelect
            name="partition"
            :label="t('secrets.backends.form.partition')"
            :options="partitionOptions"
            data-test="secret-backend-partition"
          />
          <OFormInput
            name="region"
            required
            :label="t('secrets.backends.form.region')"
            :placeholder="raw('us-east-1')"
            data-test="secret-backend-region"
          />
          <OFormInput
            name="account"
            required
            autocomplete="off"
            :label="t('secrets.backends.form.account')"
            data-test="secret-backend-account"
          />
        </div>
      </template>
      <OFormInput
        v-else-if="kind === 'gcp_sm'"
        name="project_id"
        required
        :label="t('secrets.backends.form.projectId')"
        data-test="secret-backend-project-id"
      />
      <template v-else>
        <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <OFormInput
            name="tenant_id"
            required
            :label="t('secrets.backends.form.tenantId')"
            :help-text="t('secrets.backends.form.tenantHint')"
            data-test="secret-backend-tenant-id"
          />
          <OFormSelect
            name="cloud"
            :label="t('secrets.backends.form.cloud')"
            :options="cloudOptions"
            data-test="secret-backend-cloud"
          />
        </div>
        <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <OFormInput
            name="client_id"
            required
            :label="t('secrets.backends.form.clientId')"
            data-test="secret-backend-client-id"
          />
          <OFormInput
            name="vault_url"
            required
            :label="t('secrets.backends.form.vaultUrl')"
            :placeholder="raw('https://acme.vault.azure.net')"
            data-test="secret-backend-vault-url"
          />
        </div>
      </template>

      <div class="flex flex-col gap-1" data-test="secret-backend-credential">
        <span class="text-text-heading text-sm font-medium">{{ credentialLabel }}</span>
        <WriteOnlyField
          v-if="credentialKept"
          model-value=""
          :meta="credentialMeta"
          kept
          data-test="secret-backend-credential-value"
          @update:kept="(kept: boolean) => (replacing = !kept)"
        />
        <template v-else>
          <OFormInput
            v-if="kind === 'aws_sm'"
            name="access_key_id"
            required
            autocomplete="off"
            :label="t('secrets.backends.form.accessKeyId')"
            data-test="secret-backend-access-key-id"
          />
          <OFormTextarea
            v-if="kind === 'gcp_sm'"
            name="credential"
            :rows="4"
            :placeholder="t('secrets.backends.form.keyFilePlaceholder')"
            data-test="secret-backend-credential-input"
          />
          <OFormInput
            v-else
            name="credential"
            type="password"
            :label="kind === 'aws_sm' ? t('secrets.backends.form.secretAccessKey') : undefined"
            autocomplete="new-password"
            :placeholder="t('secrets.backends.form.credentialPlaceholder')"
            data-test="secret-backend-credential-input"
          />
          <OButton
            v-if="current?.cred_set"
            variant="outline"
            size="sm"
            class="self-start"
            data-test="secret-backend-credential-cancel"
            @click="cancelCredentialReplacement"
          >
            {{ t("common.cancel") }}
          </OButton>
        </template>
        <span class="text-text-secondary text-xs">{{ credentialHint }}</span>
      </div>

      <OFormTagInput
        name="path_prefixes"
        required
        :label="t('secrets.backends.form.prefixes')"
        :help-text="t('secrets.backends.form.prefixesHint')"
        data-test="secret-backend-prefixes"
      />

      <SecretBackendIdentity v-if="current && authMode !== 'static'" :backend="current" />
    </OForm>

    <div
      v-if="current"
      class="border-border-default mt-5 flex flex-col gap-2 border-t pt-4"
      data-test="secret-backend-test"
    >
      <span class="text-text-heading text-sm font-medium">{{
        t("secrets.backends.test.title")
      }}</span>
      <div class="flex items-end gap-2">
        <OInput
          v-model="locator"
          class="min-w-0 flex-1"
          :label="t('secrets.backends.test.locator')"
          :help-text="t('secrets.backends.test.locatorHint')"
          data-test="secret-backend-test-locator"
        />
        <OButton
          variant="outline"
          size="sm"
          :disabled="!locator.trim()"
          :loading="test.isPending.value"
          data-test="secret-backend-test-btn"
          @click="runTest"
        >
          {{ t("secrets.backends.test.run") }}
        </OButton>
      </div>
      <div v-if="testResult" class="flex items-center gap-2" data-test="secret-backend-test-result">
        <OTag
          size="sm"
          :variant="testResult.ok ? 'success-soft' : 'error-soft'"
          icon=""
          :label="
            testResult.ok ? t('secrets.backends.test.passed') : t('secrets.backends.test.failed')
          "
        />
        <span v-if="testResult.code" class="text-text-secondary font-mono text-xs">{{
          testResult.code
        }}</span>
      </div>
      <span class="text-text-secondary text-xs">{{ t("secrets.backends.test.servesAfter") }}</span>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import type { OFormExposed } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import WriteOnlyField from "@/components/synthetics/configure/WriteOnlyField.vue";
import type { BackendKind, BackendTestResult, SecretBackend } from "@/services/secretBackends";
import {
  createBackendMutation,
  putBackendCredentialMutation,
  secretBackendsQuery,
  testBackendMutation,
  updateBackendMutation,
} from "@/services/secretBackends.queries";
import SecretBackendIdentity from "./SecretBackendIdentity.vue";
import { secretErrorText } from "./secretErrors";
import {
  AWS_PARTITIONS,
  AZURE_CLOUDS,
  backendDefaults,
  buildBackendCredential,
  buildBackendRequest,
  buildBackendUpdate,
  makeBackendSchema,
  type BackendForm,
} from "./SecretBackend.schema";

const props = defineProps<{ kind: BackendKind | null; backend?: SecretBackend | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const queryClient = useQueryClient();

// After the first save the drawer stays open on the saved row, so Test connection can follow.
const saved = ref<SecretBackend | null>(null);
const current = computed(() => saved.value ?? props.backend ?? null);
const replacing = ref(false);
const formRef = ref<OFormExposed | null>(null);
const locator = ref("");
const testResult = ref<BackendTestResult | null>(null);

watch(
  () => [props.kind, props.backend?.id],
  () => {
    saved.value = null;
    replacing.value = false;
    locator.value = "";
    testResult.value = null;
  },
);

const authMode = computed(() => current.value?.auth_mode ?? "static");
const credentialKept = computed(() => !!current.value?.cred_set && !replacing.value);
// The row has no credential timestamp; its own updated_at/by is the closest the server gives.
const credentialMeta = computed(() =>
  current.value
    ? { updated_at: current.value.updated_at, updated_by: current.value.updated_by }
    : undefined,
);

const PROVIDER: Record<BackendKind, () => I18nText> = {
  aws_sm: () => t("secrets.backends.providers.aws"),
  gcp_sm: () => t("secrets.backends.providers.gcp"),
  azure_kv: () => t("secrets.backends.providers.azure"),
};
const title = computed(() =>
  props.kind
    ? t("secrets.backends.form.connect", { provider: PROVIDER[props.kind]() })
    : t("secrets.backends.title"),
);
const signInLabel = computed((): I18nText => {
  if (authMode.value !== "static") return t("secrets.backends.signIn.identity");
  if (props.kind === "gcp_sm") return t("secrets.backends.signIn.serviceAccountKey");
  if (props.kind === "azure_kv") return t("secrets.backends.signIn.clientSecret");
  return t("secrets.backends.signIn.accessKey");
});
const credentialLabel = computed((): I18nText => {
  if (props.kind === "gcp_sm") return t("secrets.backends.form.keyFile");
  if (props.kind === "azure_kv") return t("secrets.backends.form.clientSecret");
  return t("secrets.backends.signIn.accessKey");
});
const credentialHint = computed(() =>
  props.kind === "gcp_sm"
    ? t("secrets.backends.form.gcpTokenEndpointIgnored")
    : t("secrets.backends.form.credentialHint"),
);
const partitionOptions = AWS_PARTITIONS.map((p) => ({
  label:
    p === "aws" ? t("secrets.backends.partitions.aws") : t("secrets.backends.partitions.awsCn"),
  value: p,
}));
const cloudOptions = AZURE_CLOUDS.map((c) => ({
  label:
    c === "public"
      ? t("secrets.backends.clouds.global")
      : c === "us_gov"
        ? t("secrets.backends.clouds.usGov")
        : t("secrets.backends.clouds.china"),
  value: c,
}));

const create = useMutation(() => createBackendMutation(orgId.value));
const update = useMutation(() => updateBackendMutation(orgId.value));
const putCredential = useMutation(() => putBackendCredentialMutation(orgId.value));
const test = useMutation(() => testBackendMutation(orgId.value));

// Every write bumps backend_rev, so the next edit must start from the server's row.
const freshRow = async (id: string): Promise<SecretBackend | undefined> => {
  const rows = await queryClient
    .fetchQuery({ ...secretBackendsQuery(orgId.value), staleTime: 0 })
    .catch(() => [] as SecretBackend[]);
  return rows.find((b) => b.id === id);
};

// Keeps the drawer on a just-created backend when the list read fails; a later edit then 409s.
const unreadRow = (id: string, kind: BackendKind, value: BackendForm): SecretBackend => ({
  ...buildBackendRequest(kind, value),
  id,
  description: "",
  cred_set: !!value.credential,
  ready: false,
  secrets_count: 0,
  ttl_secs: 0,
  stale_max_secs: 0,
  backend_rev: "",
  created_by: "",
  created_at: 0,
  updated_by: "",
  updated_at: 0,
});

const cancelCredentialReplacement = () => {
  formRef.value?.form.setFieldValue("credential", "");
  formRef.value?.form.setFieldValue("access_key_id", "");
  replacing.value = false;
};

const onSubmit = async (value: BackendForm) => {
  if (!props.kind) return;
  try {
    let row = current.value;
    let id: string;
    if (row) {
      id = row.id;
      await update.mutateAsync({ id, body: buildBackendUpdate(props.kind, value, row) });
    } else {
      id = (await create.mutateAsync(buildBackendRequest(props.kind, value))).data.id;
    }
    if (value.credential && !credentialKept.value) {
      await putCredential.mutateAsync({ id, value: buildBackendCredential(props.kind, value) });
    }
    saved.value = (await freshRow(id)) ?? row ?? unreadRow(id, props.kind, value);
    replacing.value = false;
    toast({
      variant: "success",
      message: t("secrets.backends.form.saved", { name: value.name.trim() }),
    });
  } catch (e) {
    toast({ variant: "error", message: secretErrorText(t, e, t("secrets.backends.form.failed")) });
  } finally {
    putCredential.reset();
  }
};

const runTest = async () => {
  const target = locator.value.trim();
  // The server answers a test without a locator with 400 `locator_required`.
  if (!current.value || !target) return;
  try {
    const res = await test.mutateAsync({ id: current.value.id, locator: target });
    testResult.value = res.data;
  } catch (e) {
    testResult.value = {
      ok: false,
      code: (e as { response?: { data?: { code?: string } } })?.response?.data?.code,
    };
  }
};
</script>
