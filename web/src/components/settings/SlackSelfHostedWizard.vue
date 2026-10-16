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

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import { useSlackOAuthPopup } from "@/composables/slack/useSlackOAuthPopup";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import {
  checkConnectivityMutation,
  confirmConnectionMutation,
  connectInstallationMutation,
  createInstallationMutation,
  installExchangeMutation,
  installUrlMutation,
  linkAllMutation,
  putOrgAccessMutation,
  slackInstallationsQuery,
  slackLinkingQuery,
  slackManifestQuery,
  slackOrgAccessQuery,
  slackPrerequisitesQuery,
  startConnectionMutation,
  testInstallationMutation,
  uninstallInstallationMutation,
  updateCredentialsMutation,
  updateLinkingMutation,
} from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  InstallationView,
  SlackAlreadyInstalledResponse,
  SlackApiError,
  SlackConnectionConfirmResponse,
  SlackConnectivityResponse,
  SlackCreateInstallationRequest,
  SlackCreateInstallationResponse,
  SlackInstallExchangeResponse,
  SlackTakeOverCandidate,
  SlackTestResponse,
  SlackUninstallResponse,
} from "@/types/slack";
import { copyToClipboard } from "@/utils/clipboard";
import { buildSlackManifestUrlFrom } from "@/utils/slackManifest";
import { isSlackUrl, serverMessageOf, statusOf } from "@/utils/slackLink";
import { installerDomainDefault } from "@/utils/slackSettings";
import SlackCheckList, { type SlackCheckItem } from "./SlackCheckList.vue";
import SlackPrerequisites from "./SlackPrerequisites.vue";
import {
  createAppDefaults,
  makeAppTokenSchema,
  makeCreateAppSchema,
  makeLinkingSchema,
  type AppTokenForm,
  type CreateAppForm,
  type LinkingForm,
} from "./SlackSettings.schema";

const props = defineProps<{ installation: InstallationView | null }>();

const emit = defineEmits<{ done: []; cancel: [] }>();

/** A 409 from row 2 or row 6 for the Slack team of an instance workspace (R-81) or of org workspaces (R-82). */
interface WizardRefusal {
  message: string;
  instanceTeam: boolean;
  contact: string | null;
  candidates: SlackTakeOverCandidate[];
}

/** `org_ids` is null when only row 24 knows which orgs the workspace serves. */
interface TakeOverOption {
  installation_id: string;
  team_name: string;
  org_ids: string[] | null;
}

const SLACK_APPS_URL = "https://api.slack.com/apps";
const INSTANCE_TEAM_DETAIL = "instance_team";

const takeOverOf = (detail: unknown): SlackTakeOverCandidate[] => {
  if (typeof detail !== "string" || !detail.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(detail) as { take_over?: unknown };
    return Array.isArray(parsed.take_over) ? (parsed.take_over as SlackTakeOverCandidate[]) : [];
  } catch {
    return [];
  }
};

const refusalOf = (error: unknown): WizardRefusal | null => {
  const message = serverMessageOf(error);
  if (!message) return null;
  const body = (error as { response?: { data?: Partial<SlackApiError> } }).response?.data;
  return {
    message,
    instanceTeam: body?.error_detail === INSTANCE_TEAM_DETAIL,
    contact: body?.hint?.trim() || null,
    candidates: takeOverOf(body?.error_detail),
  };
};

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const userEmail = computed<string>(() => store.state.userInfo?.email ?? "");
const orgName = computed<string>(() => store.state.selectedOrganization?.name || org.value);
const { isMetaOrg } = useIsMetaOrg();
const queryClient = useQueryClient();
const installations = useQuery(() =>
  Object.assign(slackInstallationsQuery(org.value), { enabled: !!org.value }),
);

const initialStep = (): number => {
  if (!props.installation) return 0;
  return props.installation.status === "pending" ? 3 : 4;
};
const step = ref(initialStep());

const created = ref<SlackCreateInstallationResponse | null>(null);
const current = computed<InstallationView | null>(
  () => props.installation ?? created.value?.installation ?? null,
);
const installationId = computed(() => current.value?.id ?? "");
const appUrl = (page: string): string =>
  `${SLACK_APPS_URL}/${encodeURIComponent(current.value?.app_id ?? "")}/${page}`;
// Slack's own refusal (another app's credentials, a Slack error code) says more than a generic line.
const serverReason =
  (fallback: () => I18nText) =>
  (error?: unknown): I18nText => {
    const message = serverMessageOf(error);
    return message ? raw(message) : fallback();
  };

const prerequisites = useQuery(() =>
  Object.assign(slackPrerequisitesQuery(org.value), {
    enabled: step.value === 0 && !!org.value,
  }),
);
const prereqBlocked = computed(
  () =>
    !prerequisites.data.value ||
    prerequisites.data.value.checks.some((check) => check.status === "fail"),
);

const connectivity = useMutation(() => checkConnectivityMutation(org.value));
const connectivityResult = ref<SlackConnectivityResponse | null>(null);
// The mutation toasts a failure itself; Next then stays blocked without a result.
const runConnectivity = async (): Promise<void> => {
  try {
    connectivityResult.value = await connectivity.mutateAsync({});
  } catch {
    connectivityResult.value = null;
  }
};
const connectivityItems = computed<SlackCheckItem[]>(() =>
  (connectivityResult.value?.checks ?? []).map((check) => ({
    key: check.host,
    label: raw(check.host),
    status: check.status,
    detail: check.detail,
  })),
);
const connectivityBlocked = computed(
  () =>
    !connectivityResult.value ||
    connectivityResult.value.checks.some((check) => check.status === "fail"),
);
watch(
  step,
  (value) => {
    if (value === 1 && !connectivityResult.value) void runConnectivity();
  },
  { immediate: true },
);

const manual = ref(false);
const createRefusal = ref<WizardRefusal | null>(null);
// The Create step shows every refusal in place, beside the token it refused.
const createInstallation = useMutation(() => {
  const options = createInstallationMutation(org.value);
  return { ...options, meta: { ...options.meta, silentError: true } };
});
const createApp = async (value: CreateAppForm): Promise<void> => {
  const body: SlackCreateInstallationRequest = manual.value
    ? {
        mode: value.mode,
        client_id: value.client_id,
        client_secret: value.client_secret,
        ...(value.mode === "http" ? { signing_secret: value.signing_secret } : {}),
        ...(value.mode === "socket" && value.app_token ? { app_token: value.app_token } : {}),
      }
    : {
        mode: value.mode,
        config_refresh_token: value.config_refresh_token,
        channel_history: value.channel_history,
      };
  createRefusal.value = null;
  try {
    created.value = await createInstallation.mutateAsync(body);
  } catch (error) {
    createRefusal.value = refusalOf(error) ?? {
      message: t("common.unknownError"),
      instanceTeam: false,
      contact: null,
      candidates: [],
    };
    return;
  }
  leftApp.value = null;
  installedTeam.value = null;
  step.value = 3;
};
const createForm = useOForm({
  defaultValues: createAppDefaults(),
  schema: makeCreateAppSchema(t, () => manual.value),
  onSubmit: createApp,
});
const mode = createForm.useStore((s) => s.values.mode);
const channelHistory = createForm.useStore((s) => s.values.channel_history);
const manifest = useQuery(() =>
  Object.assign(
    slackManifestQuery(org.value, { mode: mode.value, channel_history: channelHistory.value }),
    {
      enabled: step.value === 2 && manual.value && !!org.value,
    },
  ),
);
const manifestUrl = computed(() =>
  manifest.data.value ? buildSlackManifestUrlFrom(manifest.data.value) : undefined,
);
const manifestCode = computed(() =>
  manifest.data.value ? JSON.stringify(manifest.data.value, null, 2) : "",
);

const installedTeam = ref<string | null>(null);
const installRefusal = ref<WizardRefusal | null>(null);
const alreadyInstalled = ref<SlackAlreadyInstalledResponse | null>(null);
const appTokenSaved = ref(false);
const startOverOpen = ref(false);
// The Slack app Start over left behind: O2 could not delete it, or never created it.
const leftApp = ref<{ appId: string; url: string; failed: boolean; reason: string } | null>(null);
const installUrl = useMutation(() => installUrlMutation(org.value));
const installExchange = useMutation(() => installExchangeMutation(org.value));
const uninstall = useMutation(() => uninstallInstallationMutation(org.value));
const connectInstallation = useMutation(() => connectInstallationMutation(org.value));
const updateCredentials = useMutation(() =>
  updateCredentialsMutation(org.value, installationId.value),
);
// A same-team refusal is shown in place; any other failure keeps the popup's toast.
const exchangeInstall = async (code: string, state: string) => {
  installRefusal.value = null;
  try {
    return await installExchange.mutateAsync({ code, state });
  } catch (error) {
    const refusal = refusalOf(error);
    if (!refusal || (!refusal.instanceTeam && !refusal.candidates.length)) throw error;
    installRefusal.value = refusal;
    return null;
  }
};
const installPopup = useSlackOAuthPopup<SlackInstallExchangeResponse | null>({
  start: async () => {
    const fresh = created.value;
    if (fresh && fresh.installation.id === installationId.value) return fresh.authorize_url;
    return (await installUrl.mutateAsync(installationId.value)).authorize_url;
  },
  exchange: ({ code, state }) => exchangeInstall(code, state),
  onSuccess: (result) => {
    if (!result) return;
    if ("already_installed" in result) {
      alreadyInstalled.value = result;
      return;
    }
    installedTeam.value = result.installation.team_name;
  },
  messages: {
    startFailed: serverReason(() => t("alert_destinations.slackOAuth.startFailed")),
    exchangeFailed: serverReason(() => t("alert_destinations.slackOAuth.exchangeFailed")),
  },
});
const pendingInstall = computed(
  () => current.value?.status === "pending" && installedTeam.value === null && !created.value,
);
const needsAppToken = computed(
  () =>
    current.value?.mode === "socket" &&
    current.value.app_token_state !== "ok" &&
    !appTokenSaved.value,
);
const installBlocked = computed(() => installedTeam.value === null || needsAppToken.value);
const appTokenSchema = makeAppTokenSchema(t);
const saveAppToken = async (value: AppTokenForm): Promise<void> => {
  await updateCredentials.mutateAsync({ app_token: value.app_token });
  appTokenSaved.value = true;
};
const startOver = async (): Promise<void> => {
  if (!installationId.value) return;
  const appId = current.value?.app_id ?? "";
  let result: SlackUninstallResponse;
  try {
    result = await uninstall.mutateAsync(installationId.value);
  } catch {
    return;
  }
  const url = result.delete_app_url;
  leftApp.value =
    url && isSlackUrl(url, "api.slack.com")
      ? {
          appId,
          url,
          failed: result.app_deleted === false,
          reason: result.app_delete_error ?? "",
        }
      : null;
  created.value = null;
  installedTeam.value = null;
  installRefusal.value = null;
  alreadyInstalled.value = null;
  appTokenSaved.value = false;
  step.value = 2;
};

const instanceTeam = computed(() => {
  const data = installations.data.value;
  return (
    data?.instance?.team_name ??
    data?.installations.find((i) => i.scope === "instance")?.team_name ??
    ""
  );
});
const instanceContact = computed(
  () => installRefusal.value?.contact ?? installations.data.value?.instance?.help_contact ?? null,
);
const copyRequest = (): void => {
  void copyToClipboard(
    t("slackApp.connect.requestText", {
      name: orgName.value,
      org: org.value,
      team: instanceTeam.value,
    }),
    t,
    { successMessage: t("slackApp.connect.requestCopied") },
  );
};

// R-82: _meta takes over an active org workspace instead of installing a second app in its team.
const takeOverRefusal = computed(() => {
  for (const refusal of [installRefusal.value, createRefusal.value]) {
    if (refusal?.candidates.length) return refusal;
  }
  return null;
});
const takeOverOptions = computed<TakeOverOption[]>(() => {
  const refused = takeOverRefusal.value;
  if (refused) return refused.candidates.map((c) => ({ ...c }));
  if (!isMetaOrg.value || step.value !== 2) return [];
  return (installations.data.value?.available ?? []).map((a) => ({ ...a, org_ids: null }));
});
const takeOverTarget = ref("");
const takingOver = ref<string | null>(null);
const takeOverError = ref<string | null>(null);
const putOrgAccess = useMutation(() => {
  const options = putOrgAccessMutation(org.value, takeOverTarget.value);
  return { ...options, meta: { ...options.meta, silentError: true } };
});
const servedOrgIds = async (option: TakeOverOption): Promise<string[]> => {
  if (option.org_ids) return option.org_ids;
  const view = await queryClient.fetchQuery(slackOrgAccessQuery(org.value, option.installation_id));
  return view.orgs.map((row) => row.org_id);
};
const takeOver = async (option: TakeOverOption): Promise<void> => {
  takingOver.value = option.installation_id;
  takeOverError.value = null;
  const pendingId = installationId.value;
  try {
    const orgIds = await servedOrgIds(option);
    takeOverTarget.value = option.installation_id;
    // useMutation re-reads its options on the next tick.
    await nextTick();
    await putOrgAccess.mutateAsync({ orgs: [...new Set([...orgIds, org.value])] });
  } catch (error) {
    takeOverError.value = serverMessageOf(error) ?? t("common.unknownError");
    return;
  } finally {
    takingOver.value = null;
  }
  if (pendingId) await uninstall.mutateAsync(pendingId).catch(() => undefined);
  emit("done");
};
// The team already runs this app for another org: join that installation, then drop the unused pending one.
const connectWithTicket = async (): Promise<void> => {
  const ticket = alreadyInstalled.value;
  const pendingId = installationId.value;
  if (!ticket) return;
  try {
    await connectInstallation.mutateAsync({
      installationId: ticket.already_installed.installation_id,
      body: { connect_ticket: ticket.connect_ticket },
    });
  } catch (error) {
    if (statusOf(error) === 410) alreadyInstalled.value = null;
    return;
  }
  if (pendingId) await uninstall.mutateAsync(pendingId).catch(() => undefined);
  emit("done");
};

const testResult = ref<SlackTestResponse | null>(null);
const signInPassed = ref(false);
const testInstallation = useMutation(() =>
  testInstallationMutation(org.value, installationId.value),
);
const startConnection = useMutation(() => startConnectionMutation(org.value));
const confirmConnection = useMutation(() => confirmConnectionMutation(org.value));
const updateLinking = useMutation(() => updateLinkingMutation(org.value, installationId.value));
const linkAll = useMutation(() => linkAllMutation(org.value, installationId.value));
const linking = useQuery(() =>
  Object.assign(slackLinkingQuery(org.value, installationId.value), {
    enabled: step.value === 4 && !!installationId.value,
  }),
);
const signInPopup = useSlackOAuthPopup<SlackConnectionConfirmResponse>({
  start: async () => {
    signInPassed.value = false;
    return (
      await startConnection.mutateAsync({
        installationId: installationId.value,
        purpose: "test",
      })
    ).url;
  },
  exchange: ({ code, state }) =>
    confirmConnection.mutateAsync({ oidc_code: code, oidc_state: state }),
  onSuccess: (result) => {
    signInPassed.value = "test" in result && result.test === "pass";
  },
  messages: {
    startFailed: serverReason(() => t("alert_destinations.slackOAuth.startFailed")),
    exchangeFailed: serverReason(() => t("alert_destinations.slackOAuth.exchangeFailed")),
  },
});
const testVerifyUrl = computed(() => {
  const url = testResult.value?.verify_url;
  return isSlackUrl(url, "api.slack.com") ? url : null;
});
const runChecks = async (): Promise<void> => {
  try {
    testResult.value = await testInstallation.mutateAsync({});
  } catch {
    testResult.value = null;
  }
};
const testItems = computed<SlackCheckItem[]>(() =>
  (testResult.value?.checks ?? []).map((check) => ({
    key: check.id,
    label: t(`slackApp.card.checks.${check.id}`),
    status: check.status,
    detail: check.detail,
  })),
);
const linkingSchema = makeLinkingSchema(t);
// A public installer domain is never prefilled, so the box then starts unchecked.
const linkingDefaults = computed<LinkingForm>(() => {
  const saved = linking.data.value?.domains ?? [];
  const domains = saved.length ? [...saved] : installerDomainDefault(userEmail.value);
  return { enabled: (linking.data.value?.enabled ?? false) || domains.length > 0, domains };
});
const matches = computed(() => linking.data.value?.counts.matches_not_linked ?? 0);
const finish = async (value: LinkingForm): Promise<void> => {
  await updateLinking.mutateAsync({ enabled: value.enabled, domains: value.domains });
  emit("done");
};

// Start over removes the installation under the wizard; the steps that need one go back to Create.
watch(current, (installation) => {
  if (!installation && step.value > 2) step.value = 2;
});

const nextBlocked = computed(() => {
  if (step.value === 0) return prereqBlocked.value;
  if (step.value === 1) return connectivityBlocked.value;
  if (step.value === 3) return installBlocked.value;
  return false;
});
</script>

<template>
  <div class="flex flex-col gap-4" data-test="slack-wizard" :data-step="step">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-text-heading m-0 text-xl font-semibold">{{ t("slackApp.wizard.title") }}</h2>
      <p class="text-text-secondary m-0 text-sm">{{ t("slackApp.wizard.subtitle") }}</p>
    </div>

    <OCard
      v-if="takeOverOptions.length"
      variant="outlined"
      class="gap-3 p-5"
      data-test="slack-wizard-take-over"
    >
      <h3 class="text-text-heading m-0 text-base font-semibold">
        {{ t("slackApp.wizard.takeOverTitle") }}
      </h3>
      <OBanner v-if="takeOverRefusal" variant="error-soft" dense icon="error-outline">
        {{ raw(takeOverRefusal.message) }}
      </OBanner>
      <OBanner
        v-if="takeOverError"
        variant="error-soft"
        dense
        icon="error-outline"
        data-test="slack-wizard-take-over-error"
      >
        {{ raw(takeOverError) }}
      </OBanner>
      <div
        v-for="option in takeOverOptions"
        :key="option.installation_id"
        class="border-border-default flex flex-wrap items-center justify-between gap-3 border-t pt-3"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-body text-sm font-medium">{{ raw(option.team_name) }}</span>
          <span v-if="option.org_ids?.length" class="text-text-secondary text-xs">
            {{ t("slackApp.wizard.takeOverOrgs", { orgs: option.org_ids.join(", ") }) }}
          </span>
        </div>
        <OButton
          variant="outline"
          size="sm-action"
          :loading="takingOver === option.installation_id"
          :disabled="takingOver !== null && takingOver !== option.installation_id"
          :data-test="`slack-wizard-take-over-${option.installation_id}`"
          @click="takeOver(option)"
        >
          {{ t("slackApp.wizard.takeOverAction") }}
        </OButton>
      </div>
    </OCard>

    <OStepper :model-value="step" :animated="false" orientation="horizontal">
      <OStep :name="0" :title="t('slackApp.wizard.steps.prerequisites')" :done="step > 0">
        <div class="flex flex-col gap-3 pt-3">
          <h3 class="text-text-heading m-0 text-base font-semibold">
            {{ t("slackApp.prereq.title") }}
          </h3>
          <p class="text-text-secondary m-0 text-sm">{{ t("slackApp.prereq.subtitle") }}</p>
          <OSpinner v-if="prerequisites.isPending.value" size="sm" />
          <OEmptyState
            v-else-if="prerequisites.isError.value"
            size="compact"
            preset="load-error"
            :title="t('slackApp.prereq.loadFailed')"
            :backdrop="false"
            data-test="slack-wizard-prereq-error"
            @action="prerequisites.refetch()"
          />
          <SlackPrerequisites
            v-else-if="prerequisites.data.value"
            :checks="prerequisites.data.value.checks"
            :loading="prerequisites.isFetching.value"
            @recheck="prerequisites.refetch()"
          />
          <p class="text-text-secondary m-0 text-xs">
            {{ t("slackApp.prereq.helmHint", { variable: raw("O2_MASTER_ENCRYPTION_KEY") }) }}
          </p>
        </div>
      </OStep>

      <OStep :name="1" :title="t('slackApp.wizard.steps.connection')" :done="step > 1">
        <div class="flex flex-col gap-3 pt-3" data-test="slack-wizard-connectivity">
          <h3 class="text-text-heading m-0 text-base font-semibold">
            {{ t("slackApp.wizard.connection.title") }}
          </h3>
          <p class="text-text-secondary m-0 text-sm">
            {{ t("slackApp.wizard.connection.description") }}
          </p>
          <OSpinner v-if="connectivity.isPending.value" size="sm" />
          <template v-else-if="connectivityResult">
            <OBanner
              :variant="connectivityBlocked ? 'error-soft' : 'success'"
              dense
              :icon="connectivityBlocked ? 'error-outline' : 'check-circle'"
            >
              {{
                connectivityBlocked
                  ? t("slackApp.wizard.connection.someFailed")
                  : t("slackApp.wizard.connection.allPassed")
              }}
            </OBanner>
            <SlackCheckList :items="connectivityItems" />
            <ul class="text-text-secondary m-0 flex list-none flex-col gap-1 p-0 text-xs">
              <li v-if="connectivityResult.proxy">
                {{ t("slackApp.wizard.connection.proxy", { proxy: connectivityResult.proxy }) }}
              </li>
              <li v-if="connectivityResult.ca_bundle">
                {{
                  t("slackApp.wizard.connection.caBundle", { path: connectivityResult.ca_bundle })
                }}
              </li>
              <li v-if="connectivityResult.socket_url_host">
                {{
                  t("slackApp.wizard.connection.socketHost", {
                    host: connectivityResult.socket_url_host,
                  })
                }}
              </li>
            </ul>
          </template>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="refresh"
            class="w-fit"
            :loading="connectivity.isPending.value"
            @click="runConnectivity"
          >
            {{ t("slackApp.prereq.recheck") }}
          </OButton>
        </div>
      </OStep>

      <OStep
        :name="2"
        :title="t('slackApp.wizard.steps.createApp')"
        :done="step > 2"
        :error="!!createRefusal"
      >
        <OForm
          :form="createForm"
          class="flex flex-col gap-5 pt-3"
          data-test="slack-wizard-create-form"
        >
          <h3 class="text-text-heading m-0 text-base font-semibold">
            {{ t("slackApp.wizard.create.title") }}
          </h3>
          <OBanner
            v-if="createRefusal && !createRefusal.candidates.length"
            variant="error-soft"
            icon="error-outline"
            :data-test="
              createRefusal.instanceTeam
                ? 'slack-wizard-instance-team'
                : 'slack-wizard-create-error'
            "
          >
            <template v-if="createRefusal.instanceTeam">
              <span class="font-semibold">{{ raw(createRefusal.message) }}</span>
              {{ t("slackApp.wizard.noAppCreated") }}
            </template>
            <template v-else>{{ raw(createRefusal.message) }}</template>
          </OBanner>
          <OBanner
            v-if="leftApp"
            variant="warning"
            icon="warning"
            data-test="slack-wizard-app-left"
          >
            <div class="flex flex-col gap-0.5">
              <span class="font-medium">
                {{ t("slackApp.wizard.install.appLeftTitle", { appId: leftApp.appId }) }}
              </span>
              <span>
                {{
                  leftApp.failed
                    ? t("slackApp.wizard.install.appNotDeleted")
                    : t("slackApp.wizard.install.appNotCreatedByO2")
                }}
              </span>
              <span
                v-if="leftApp.failed && leftApp.reason"
                data-test="slack-wizard-app-left-reason"
              >
                {{ raw(leftApp.reason) }}
              </span>
            </div>
            <template #actions>
              <OButton
                as="a"
                :href="leftApp.url"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="sm-action"
                icon-right="open-in-new"
                data-test="slack-wizard-delete-app"
              >
                {{ t("slackApp.uninstall.deleteApp") }}
              </OButton>
            </template>
          </OBanner>
          <OFormRadioGroup
            name="mode"
            :label="t('slackApp.wizard.create.modeLabel')"
            orientation="horizontal"
            class="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            <ORadio value="socket" variant="card" data-test="slack-wizard-mode-socket">
              <template #label>
                <span class="flex flex-col gap-1">
                  <span>{{ t("slackApp.wizard.create.socket") }}</span>
                  <span class="text-text-secondary text-xs font-normal">
                    {{ t("slackApp.wizard.create.socketDescription") }}
                  </span>
                </span>
              </template>
            </ORadio>
            <ORadio value="http" variant="card" data-test="slack-wizard-mode-http">
              <template #label>
                <span class="flex flex-col gap-1">
                  <span>{{ t("slackApp.wizard.create.http") }}</span>
                  <span class="text-text-secondary text-xs font-normal">
                    {{ t("slackApp.wizard.create.httpDescription") }}
                  </span>
                </span>
              </template>
            </ORadio>
          </OFormRadioGroup>
          <OFormSwitch
            name="channel_history"
            :label="t('slackApp.wizard.create.channelHistory')"
            data-test="slack-wizard-channel-history"
          />
          <OBanner variant="info" dense icon="verified-user" data-test="slack-wizard-consent">
            {{
              channelHistory ? t("slackApp.connect.consent") : t("slackApp.connect.consentPrivate")
            }}
          </OBanner>

          <template v-if="!manual">
            <div class="flex flex-col gap-1">
              <OFormInput
                name="config_refresh_token"
                type="password"
                revealable
                autocomplete="off"
                :label="t('slackApp.wizard.create.tokenLabel')"
                :help-text="t('slackApp.wizard.create.tokenHelp')"
                required
                data-test="slack-wizard-config-token"
              />
              <OButton
                as="a"
                :href="SLACK_APPS_URL"
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost-primary"
                size="xs"
                icon-right="open-in-new"
                class="w-fit"
              >
                {{ t("slackApp.wizard.create.generateToken") }}
              </OButton>
            </div>
          </template>
          <template v-else>
            <p class="text-text-secondary m-0 text-sm">
              {{ t("slackApp.wizard.create.manualHelp") }}
            </p>
            <OButton
              as="a"
              :href="manifestUrl"
              :disabled="!manifestUrl"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="sm-action"
              icon-right="open-in-new"
              class="w-fit"
              data-test="slack-wizard-open-manifest"
            >
              {{ t("slackApp.wizard.create.openManifest") }}
            </OButton>
            <OCodeBlock
              v-if="manifestCode"
              :code="manifestCode"
              lang="json"
              chrome="editor"
              filename="manifest.json"
              :max-lines="12"
            />
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <OFormInput
                name="client_id"
                :label="t('slackApp.wizard.create.clientId')"
                required
                data-test="slack-wizard-client-id"
              />
              <OFormInput
                name="client_secret"
                type="password"
                revealable
                autocomplete="off"
                :label="t('slackApp.wizard.create.clientSecret')"
                required
                data-test="slack-wizard-client-secret"
              />
              <OFormInput
                v-if="mode === 'http'"
                name="signing_secret"
                type="password"
                revealable
                autocomplete="off"
                :label="t('slackApp.wizard.create.signingSecret')"
                required
                data-test="slack-wizard-signing-secret"
              />
              <OFormInput
                v-else
                name="app_token"
                type="password"
                revealable
                autocomplete="off"
                :label="t('slackApp.wizard.create.appToken')"
                data-test="slack-wizard-app-token"
              />
            </div>
          </template>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <OButton variant="outline" size="sm-action" @click="step = 1">
              {{ t("slackApp.wizard.back") }}
            </OButton>
            <OButton
              variant="ghost-primary"
              size="sm-action"
              data-test="slack-wizard-manual"
              @click="manual = !manual"
            >
              {{
                manual ? t("slackApp.wizard.create.useToken") : t("slackApp.wizard.create.manual")
              }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              type="submit"
              data-test="slack-wizard-create"
            >
              {{
                manual
                  ? t("slackApp.wizard.create.saveManual")
                  : t("slackApp.wizard.create.createButton")
              }}
            </OButton>
          </div>
        </OForm>
      </OStep>

      <OStep
        :name="3"
        :title="t('slackApp.wizard.steps.install')"
        :done="step > 3"
        :error="!!installRefusal"
      >
        <div class="flex flex-col gap-4 pt-3">
          <h3 class="text-text-heading m-0 text-base font-semibold">
            {{ t("slackApp.wizard.install.title") }}
          </h3>
          <template v-if="installRefusal">
            <OBanner
              v-if="installRefusal.instanceTeam"
              variant="error-soft"
              icon="error-outline"
              data-test="slack-wizard-instance-team"
            >
              <div class="flex flex-col gap-1">
                <span class="font-semibold">{{ raw(installRefusal.message) }}</span>
                <span>
                  {{ t("slackApp.wizard.instanceTeamRemoved", { team: instanceTeam }) }}
                  <template v-if="instanceContact">
                    {{ t("slackApp.wizard.instanceAdminContact", { contact: instanceContact }) }}
                  </template>
                </span>
              </div>
            </OBanner>
            <div class="flex flex-wrap justify-end gap-2">
              <OButton
                v-if="installRefusal.instanceTeam"
                variant="outline"
                size="sm-action"
                icon-left="content-copy"
                data-test="slack-copy-request"
                @click="copyRequest"
              >
                {{ t("slackApp.connect.copyRequest") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm-action"
                data-test="slack-wizard-start-over"
                @click="startOverOpen = true"
              >
                {{ t("slackApp.wizard.install.startOver") }}
              </OButton>
            </div>
          </template>
          <OBanner
            v-else-if="pendingInstall"
            variant="warning"
            icon="schedule"
            data-test="slack-wizard-pending"
          >
            <div class="flex flex-col gap-0.5">
              <span class="font-medium">{{ t("slackApp.wizard.install.pendingTitle") }}</span>
              <span>
                {{
                  t("slackApp.wizard.install.pendingDescription", { appId: current?.app_id ?? "" })
                }}
              </span>
            </div>
          </OBanner>
          <span v-else class="flex items-center gap-2 text-sm">
            <OIcon name="check-circle" size="sm" class="text-status-positive" />
            {{ t("slackApp.wizard.install.created", { appId: current?.app_id ?? "" }) }}
          </span>

          <OBanner
            v-if="alreadyInstalled"
            variant="warning"
            icon="info"
            data-test="slack-wizard-already-installed"
          >
            {{
              t("slackApp.connect.alreadyInstalled", {
                team: alreadyInstalled.already_installed.team_name,
              })
            }}
            <template #actions>
              <OButton
                variant="primary"
                size="sm-action"
                :loading="connectInstallation.isPending.value || uninstall.isPending.value"
                data-test="slack-wizard-connect-ticket"
                @click="connectWithTicket"
              >
                {{ t("slackApp.connect.connectExisting") }}
              </OButton>
            </template>
          </OBanner>
          <OCard
            v-else-if="installedTeam === null && !installRefusal"
            variant="outlined"
            class="gap-3 p-4"
          >
            <p class="text-text-secondary m-0 text-sm">
              {{ t("slackApp.wizard.install.allowHint") }}
            </p>
            <div class="flex flex-wrap gap-2">
              <OButton
                variant="primary"
                size="sm-action"
                :loading="installPopup.connecting.value"
                data-test="slack-wizard-allow"
                @click="installPopup.open()"
              >
                {{
                  pendingInstall
                    ? t("slackApp.wizard.install.finishInstall")
                    : t("slackApp.wizard.install.allow")
                }}
              </OButton>
              <OButton
                v-if="pendingInstall"
                variant="outline-destructive"
                size="sm-action"
                data-test="slack-wizard-start-over"
                @click="startOverOpen = true"
              >
                {{ t("slackApp.wizard.install.startOver") }}
              </OButton>
            </div>
          </OCard>
          <span
            v-else-if="!installRefusal"
            class="flex items-center gap-2 text-sm"
            data-test="slack-wizard-installed"
          >
            <OIcon name="check-circle" size="sm" class="text-status-positive" />
            {{ t("slackApp.wizard.install.installed", { team: installedTeam }) }}
          </span>

          <OForm
            v-if="installedTeam !== null && needsAppToken"
            :schema="appTokenSchema"
            :default-values="{ app_token: '' }"
            class="flex flex-col gap-3"
            data-test="slack-wizard-app-token-form"
            @submit="saveAppToken"
          >
            <OFormInput
              name="app_token"
              type="password"
              revealable
              autocomplete="off"
              :label="t('slackApp.wizard.create.appToken')"
              :help-text="t('slackApp.wizard.install.appTokenHelp')"
              required
              data-test="slack-wizard-app-token-field"
            />
            <div class="flex flex-wrap gap-2">
              <OButton
                as="a"
                :href="appUrl('general')"
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost-primary"
                size="sm-action"
                icon-right="open-in-new"
                data-test="slack-wizard-basic-info"
              >
                {{ t("slackApp.wizard.install.openBasicInfo") }}
              </OButton>
              <OButton variant="primary" size="sm-action" type="submit">
                {{ t("slackApp.wizard.install.saveAppToken") }}
              </OButton>
            </div>
          </OForm>
          <div
            v-if="installedTeam !== null && current?.mode === 'http'"
            class="flex flex-col gap-1"
          >
            <OButton
              as="a"
              :href="appUrl('app-manifest')"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="sm-action"
              icon-right="open-in-new"
              class="w-fit"
              data-test="slack-wizard-verify"
            >
              {{ t("slackApp.wizard.install.verifyTitle") }}
            </OButton>
            <span class="text-text-secondary text-xs">{{
              t("slackApp.wizard.install.verifyHelp")
            }}</span>
          </div>
          <OBanner v-if="!installRefusal" variant="info" dense icon="info">
            {{ t("slackApp.wizard.install.collaborator") }}
          </OBanner>
        </div>
      </OStep>

      <OStep :name="4" :title="t('slackApp.wizard.steps.test')">
        <div class="flex flex-col gap-4 pt-3">
          <h3 class="text-text-heading m-0 text-base font-semibold">
            {{ t("slackApp.wizard.test.title") }}
          </h3>
          <div class="flex flex-wrap gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              :loading="testInstallation.isPending.value"
              data-test="slack-wizard-run-checks"
              @click="runChecks"
            >
              {{ t("slackApp.wizard.test.run") }}
            </OButton>
            <OButton
              variant="outline"
              size="sm-action"
              :loading="signInPopup.connecting.value"
              data-test="slack-wizard-signin-test"
              @click="signInPopup.open()"
            >
              {{ t("slackApp.wizard.test.signIn") }}
            </OButton>
          </div>
          <span class="text-text-secondary text-xs">{{
            t("slackApp.wizard.test.signInHelp")
          }}</span>
          <SlackCheckList v-if="testItems.length" :items="testItems" />
          <OButton
            v-if="testVerifyUrl"
            as="a"
            :href="testVerifyUrl"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm-action"
            icon-right="open-in-new"
            class="w-fit"
            data-test="slack-wizard-test-verify"
          >
            {{ t("slackApp.wizard.install.verifyTitle") }}
          </OButton>
          <span v-if="signInPassed" class="flex items-center gap-2 text-sm">
            <OIcon name="check-circle" size="sm" class="text-status-positive" />
            {{ t("slackApp.wizard.test.signInPassed") }}
          </span>

          <OSpinner v-if="linking.isPending.value" size="sm" />
          <OForm
            v-else
            :key="linkingDefaults.domains.join(',')"
            :schema="linkingSchema"
            :default-values="linkingDefaults"
            class="border-border-default flex flex-col gap-3 border-t pt-4"
            data-test="slack-wizard-linking-form"
            @submit="finish"
          >
            <OFormSwitch name="enabled" :label="t('slackApp.linking.auto')" />
            <p class="text-text-secondary m-0 text-xs">{{ t("slackApp.linking.autoHelp") }}</p>
            <div class="flex flex-col gap-1">
              <span class="text-text-label text-compact font-medium">{{
                t("slackApp.linking.domains")
              }}</span>
              <OFormTagInput name="domains" data-test="slack-wizard-domains" />
            </div>
            <p class="text-text-secondary m-0 text-xs">{{ t("slackApp.linking.domainsHelp") }}</p>
            <OButton
              v-if="matches > 0"
              variant="outline"
              size="sm-action"
              class="w-fit"
              :loading="linkAll.isPending.value"
              data-test="slack-wizard-link-all"
              @click="linkAll.mutate()"
            >
              {{ t("slackApp.linking.linkAllMatches", { count: matches }) }}
            </OButton>
            <div class="flex justify-end gap-2">
              <OButton variant="outline" size="sm-action" @click="step = 3">
                {{ t("slackApp.wizard.back") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm-action"
                type="submit"
                data-test="slack-wizard-finish"
              >
                {{ t("slackApp.wizard.finish") }}
              </OButton>
            </div>
          </OForm>
        </div>
      </OStep>
    </OStepper>

    <div
      v-if="step !== 2 && step !== 4 && !installRefusal"
      class="flex flex-wrap justify-end gap-2"
    >
      <OButton
        v-if="step === 0"
        variant="outline"
        size="sm-action"
        data-test="slack-wizard-cancel"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton v-else-if="step === 1" variant="outline" size="sm-action" @click="step = 0">
        {{ t("slackApp.wizard.back") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :disabled="nextBlocked"
        data-test="slack-wizard-next"
        @click="step += 1"
      >
        {{ t("slackApp.wizard.next") }}
      </OButton>
    </div>

    <ConfirmDialog
      v-model="startOverOpen"
      :title="t('slackApp.wizard.install.startOverTitle')"
      :message="t('slackApp.wizard.install.startOverMessage', { appId: current?.app_id ?? '' })"
      :ok-label="t('slackApp.wizard.install.startOver')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="startOver"
    />
  </div>
</template>
