<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import type { RadioValue } from "@/lib/forms/Radio/ORadio.types";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import destinationService, { type SlackOAuthConnection } from "@/services/alert_destination";
import { useI18nTyped } from "@/types/i18n";
import { isValidSlackWebhookUrl } from "@/utils/prebuilt-templates/slack";
import {
  buildSlackManifestUrl,
  slackManifestJson,
  SLACK_APP_NAME_MAX_LENGTH,
} from "@/utils/slackManifest";
import { isSlackOAuthCallbackMessage } from "@/utils/slackOAuth";
import { isValidResourceName } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AddDestinationForm } from "./AddDestination.schema";
import SlackWebhookFields from "./SlackWebhookFields.vue";

type FormState = { values: AddDestinationForm };

const props = defineProps<{
  orgIdentifier: string;
  isCloud: boolean;
  isEnterprise: boolean;
}>();

const emit = defineEmits<{
  flowChange: [];
  readinessChange: [ready: boolean];
}>();

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null);

if (!form) {
  throw new Error("SlackDestinationSetup must be rendered inside OForm");
}

const setupMethod = form.useStore((state: FormState) => state.values.slack_setup_method);
const destinationName = form.useStore((state: FormState) => state.values.name);
const slackAppName = form.useStore((state: FormState) => state.values.slack_app_name);
const credentials = form.useStore((state: FormState) => state.values.credentials);
const slackTeamId = form.useStore((state: FormState) => state.values.slack_team_id);
const slackTeamName = form.useStore((state: FormState) => state.values.slack_team_name);
const slackChannelId = form.useStore((state: FormState) => state.values.slack_channel_id);

const connecting = ref(false);
const manifestStep = ref(1);
const oauthWindow = shallowRef<Window | null>(null);
let popupWatcher: number | undefined;
let popupCloseGraceTimer: number | undefined;
const POPUP_CLOSE_GRACE_MS = 1_000;

const connected = computed(() => {
  const webhookUrl = credentials.value.webhookUrl;
  const channel = credentials.value.channel;
  return (
    setupMethod.value === "oauth" &&
    typeof webhookUrl === "string" &&
    isValidSlackWebhookUrl(webhookUrl) &&
    typeof channel === "string" &&
    channel.trim().length > 0 &&
    slackTeamName.value.trim().length > 0 &&
    slackTeamId.value.trim().length > 0 &&
    slackChannelId.value.trim().length > 0
  );
});

const channelName = computed(() => {
  const channel = credentials.value.channel;
  return typeof channel === "string" ? channel : "";
});

const canContinueManifest = computed(() => {
  const name = destinationName.value.trim();
  const appName = slackAppName.value.trim();
  return (
    name.length > 0 &&
    isValidResourceName(name) &&
    appName.length > 0 &&
    appName.length <= SLACK_APP_NAME_MAX_LENGTH
  );
});

// Null in OSS: the manifest flow is enterprise-only, so webhook is all that is left.
const guidedMethod = computed<"oauth" | "manifest" | null>(() => {
  if (props.isCloud) return "oauth";
  return props.isEnterprise ? "manifest" : null;
});

const manifestCode = computed(() => slackManifestJson(slackAppName.value));
const manifestUrl = computed(() => buildSlackManifestUrl(slackAppName.value));

const stopPopupWatcher = (): void => {
  if (popupWatcher !== undefined) {
    window.clearInterval(popupWatcher);
    popupWatcher = undefined;
  }
};

const releasePopup = (close: boolean): void => {
  stopPopupWatcher();
  if (popupCloseGraceTimer !== undefined) {
    window.clearTimeout(popupCloseGraceTimer);
    popupCloseGraceTimer = undefined;
  }
  if (close && oauthWindow.value && !oauthWindow.value.closed) oauthWindow.value.close();
  oauthWindow.value = null;
  connecting.value = false;
};

const clearSlackConnection = (): void => {
  form.setFieldValue("credentials.webhookUrl", "");
  form.setFieldValue("credentials.channel", "");
  form.setFieldValue("slack_team_id", "");
  form.setFieldValue("slack_team_name", "");
  form.setFieldValue("slack_channel_id", "");
};

const setManifestStep = (step: number): void => {
  manifestStep.value = step;
  emit("readinessChange", step === 3);
};

const setMethod = (value: RadioValue): void => {
  if (value !== guidedMethod.value && value !== "webhook") return;
  if (value === setupMethod.value) return;
  releasePopup(true);
  clearSlackConnection();
  setManifestStep(1);
  form.setFieldValue("slack_setup_method", value);
  emit("flowChange");
};

const applyConnection = (connection: SlackOAuthConnection): void => {
  form.setFieldValue("credentials.webhookUrl", connection.webhookUrl);
  form.setFieldValue("credentials.channel", connection.channel);
  form.setFieldValue("slack_team_id", connection.teamId);
  form.setFieldValue("slack_team_name", connection.teamName);
  form.setFieldValue("slack_channel_id", connection.channelId);
  emit("flowChange");
};

const handleOAuthMessage = async (event: MessageEvent<unknown>): Promise<void> => {
  if (
    event.origin !== window.location.origin ||
    event.source !== oauthWindow.value ||
    !isSlackOAuthCallbackMessage(event.data)
  ) {
    return;
  }

  const message = event.data;
  releasePopup(true);
  if ("error" in message) {
    toast({ variant: "error", message: t("alert_destinations.slackOAuth.authorizationDenied") });
    return;
  }

  connecting.value = true;
  try {
    const response = await destinationService.exchangeSlackOAuth({
      org_identifier: props.orgIdentifier,
      code: message.code,
      state: message.state,
    });
    applyConnection(response.data);
  } catch {
    toast({ variant: "error", message: t("alert_destinations.slackOAuth.exchangeFailed") });
  } finally {
    connecting.value = false;
  }
};

const watchPopup = (popup: Window): void => {
  stopPopupWatcher();
  popupWatcher = window.setInterval(() => {
    if (oauthWindow.value !== popup || !popup.closed) return;
    stopPopupWatcher();
    if (popupCloseGraceTimer !== undefined) return;
    popupCloseGraceTimer = window.setTimeout(() => {
      popupCloseGraceTimer = undefined;
      if (oauthWindow.value !== popup) return;
      oauthWindow.value = null;
      connecting.value = false;
      toast({ variant: "warning", message: t("alert_destinations.slackOAuth.popupClosed") });
    }, POPUP_CLOSE_GRACE_MS);
  }, 500);
};

const connectSlack = async (): Promise<void> => {
  if (!props.isCloud || connecting.value) return;
  const popup = window.open(
    "",
    "openobserve-slack-oauth",
    "popup,width=720,height=760,resizable=yes,scrollbars=yes",
  );
  if (!popup) {
    toast({ variant: "error", message: t("alert_destinations.slackOAuth.popupBlocked") });
    return;
  }

  connecting.value = true;
  oauthWindow.value = popup;
  watchPopup(popup);
  try {
    const response = await destinationService.startSlackOAuth({
      org_identifier: props.orgIdentifier,
    });
    if (oauthWindow.value !== popup || popup.closed) return;
    popup.location.href = String(response.data.authorizationUrl);
    popup.focus();
  } catch {
    releasePopup(true);
    toast({ variant: "error", message: t("alert_destinations.slackOAuth.startFailed") });
  }
};

const continueManifest = (): void => {
  if (!canContinueManifest.value) return;
  setManifestStep(2);
};

const advanceToWebhook = (): void => setManifestStep(3);
const goBackManifest = (): void => setManifestStep(Math.max(1, manifestStep.value - 1));

onMounted(() => {
  if (setupMethod.value !== guidedMethod.value && setupMethod.value !== "webhook") {
    form.setFieldValue("slack_setup_method", guidedMethod.value ?? "webhook");
  }
  emit("readinessChange", false);
  window.addEventListener("message", handleOAuthMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleOAuthMessage);
  releasePopup(true);
});
</script>

<template>
  <section class="flex w-full flex-col gap-4" data-test="slack-destination-setup">
    <div>
      <div class="text-sm font-medium">
        {{ t("alert_destinations.slackOAuth.setupMethodLabel") }}
      </div>
      <ORadioGroup
        class="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"
        :model-value="setupMethod"
        :label="t('alert_destinations.slackOAuth.setupMethodLabel')"
        orientation="horizontal"
        @update:model-value="setMethod"
      >
        <ORadio v-if="isCloud" value="oauth" variant="card" data-test="slack-setup-method-oauth">
          <template #label>
            <span class="flex flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2">
                <span>{{ t("alert_destinations.slackOAuth.oauthMethodTitle") }}</span>
                <OTag variant="primary-soft" size="xs">
                  {{ t("alert_destinations.slackOAuth.recommended") }}
                </OTag>
              </span>
              <span class="text-text-secondary text-xs font-normal">
                {{ t("alert_destinations.slackOAuth.oauthMethodDescription") }}
              </span>
            </span>
          </template>
        </ORadio>
        <ORadio
          v-else-if="isEnterprise"
          value="manifest"
          variant="card"
          data-test="slack-setup-method-manifest"
        >
          <template #label>
            <span class="flex flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2">
                <span>{{ t("alert_destinations.slackOAuth.manifestMethodTitle") }}</span>
                <OTag variant="primary-soft" size="xs">
                  {{ t("alert_destinations.slackOAuth.recommended") }}
                </OTag>
              </span>
              <span class="text-text-secondary text-xs font-normal">
                {{ t("alert_destinations.slackOAuth.manifestMethodDescription") }}
              </span>
            </span>
          </template>
        </ORadio>
        <ORadio value="webhook" variant="card" data-test="slack-setup-method-webhook">
          <template #label>
            <span class="flex flex-col gap-1">
              <span>{{ t("alert_destinations.slackOAuth.webhookMethodTitle") }}</span>
              <span class="text-text-secondary text-xs font-normal">
                {{ t("alert_destinations.slackOAuth.webhookMethodDescription") }}
              </span>
            </span>
          </template>
        </ORadio>
      </ORadioGroup>
    </div>

    <div class="w-full md:max-w-160">
      <OFormInput
        data-test="add-destination-name-input"
        name="name"
        :label="t('alerts.name')"
        required
      />
    </div>

    <template v-if="setupMethod === 'oauth' && isCloud">
      <OBanner variant="info" dense icon="verified-user" data-test="slack-oauth-permission-note">
        {{ t("alert_destinations.slackOAuth.permissionNote") }}
      </OBanner>

      <OBanner
        v-if="connected"
        variant="success"
        dense
        icon="check-circle"
        data-test="slack-oauth-connected"
      >
        {{
          t("alert_destinations.slackOAuth.connected", {
            workspace: slackTeamName,
            channel: channelName,
          })
        }}
      </OBanner>

      <OButton
        v-if="connected"
        variant="outline"
        size="sm-action"
        class="w-fit"
        icon-left="refresh"
        :loading="connecting"
        data-test="slack-oauth-reconnect-button"
        @click="connectSlack"
      >
        {{ t("alert_destinations.slackOAuth.reconnectSlack") }}
      </OButton>
      <OButton
        v-else
        variant="primary"
        size="sm-action"
        class="w-fit"
        icon-left="link"
        :loading="connecting"
        data-test="slack-oauth-connect-button"
        @click="connectSlack"
      >
        {{ t("alert_destinations.slackOAuth.connectSlack") }}
      </OButton>
    </template>

    <OStepper
      v-else-if="setupMethod === 'manifest' && !isCloud && isEnterprise"
      :model-value="manifestStep"
      :animated="false"
      orientation="horizontal"
      data-test="slack-manifest-stepper"
    >
      <OStep
        :name="1"
        :title="t('alert_destinations.slackOAuth.manifestStepApp')"
        :done="manifestStep > 1"
      >
        <div class="flex max-w-160 flex-col gap-3 pt-3">
          <OFormInput
            data-test="slack-app-name-input"
            name="slack_app_name"
            :label="t('alert_destinations.slackOAuth.manifestAppName')"
            :help-text="t('alert_destinations.slackOAuth.manifestAppNameHelp')"
            :maxlength="SLACK_APP_NAME_MAX_LENGTH"
            required
          />
          <OButton
            class="w-fit"
            variant="primary"
            size="sm-action"
            icon-right="arrow-forward"
            :disabled="!canContinueManifest"
            data-test="slack-manifest-continue-button"
            @click="continueManifest"
          >
            {{ t("alert_destinations.slackOAuth.manifestContinue") }}
          </OButton>
        </div>
      </OStep>

      <OStep
        :name="2"
        :title="t('alert_destinations.slackOAuth.manifestStepReview')"
        :done="manifestStep > 2"
      >
        <div class="flex flex-col gap-3 pt-3">
          <OBanner variant="info" dense icon="verified-user">
            {{ t("alert_destinations.slackOAuth.manifestPermissionNote") }}
          </OBanner>
          <p class="text-text-secondary m-0 text-sm">
            {{ t("alert_destinations.slackOAuth.manifestReviewHelp") }}
          </p>
          <OCodeBlock
            :code="manifestCode"
            lang="json"
            chrome="editor"
            filename="manifest.json"
            :max-lines="16"
            data-test="slack-manifest-code"
          />
          <div class="flex flex-wrap items-center gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="slack-manifest-back-button"
              @click="goBackManifest"
            >
              {{ t("alert_destinations.slackOAuth.manifestBack") }}
            </OButton>
            <OButton
              as="a"
              :href="manifestUrl"
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              size="sm-action"
              icon-right="open-in-new"
              data-test="slack-manifest-open-slack"
              @click="advanceToWebhook"
            >
              {{ t("alert_destinations.slackOAuth.manifestOpenSlack") }}
            </OButton>
          </div>
        </div>
      </OStep>

      <OStep :name="3" :title="t('alert_destinations.slackOAuth.manifestStepWebhook')">
        <div class="flex flex-col gap-3 pt-3">
          <OBanner variant="info" dense icon="info" data-test="slack-manifest-where-to-find">
            {{ t("alert_destinations.slackOAuth.manifestWhereToFind") }}
          </OBanner>
          <SlackWebhookFields show-secret-note />
          <OButton
            class="w-fit"
            variant="outline"
            size="sm-action"
            data-test="slack-manifest-back-button"
            @click="goBackManifest"
          >
            {{ t("alert_destinations.slackOAuth.manifestBack") }}
          </OButton>
        </div>
      </OStep>
    </OStepper>

    <SlackWebhookFields v-else show-secret-note />
  </section>
</template>
