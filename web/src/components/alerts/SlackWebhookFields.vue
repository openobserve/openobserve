<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    showChannel?: boolean;
    showSecretNote?: boolean;
  }>(),
  {
    showChannel: true,
    showSecretNote: false,
  },
);

const { t } = useI18nTyped();
const revealed = ref(false);
const root = ref<HTMLElement | null>(null);

const focusWebhook = (): void => {
  root.value?.querySelector<HTMLInputElement>("input")?.focus();
};

defineExpose({ focusWebhook });
</script>

<template>
  <div ref="root" class="flex w-full flex-col gap-3" data-test="slack-webhook-fields">
    <div class="w-full max-w-160">
      <OFormInput
        name="credentials.webhookUrl"
        data-test="slack-webhook-url-input"
        :label="t('alerts.prebuiltDestinations.slackWebhookUrl')"
        :type="revealed ? 'text' : 'password'"
        required
        autocomplete="new-password"
        :help-text="t('alerts.prebuiltDestinations.slackWebhookUrlHelp')"
      >
        <template #icon-right>
          <OButton
            data-test="slack-webhook-toggle-visibility"
            variant="ghost-muted"
            size="icon-sm"
            :aria-label="
              revealed
                ? t('alert_destinations.slackOAuth.hideWebhook')
                : t('alert_destinations.slackOAuth.revealWebhook')
            "
            :aria-pressed="revealed"
            @click="revealed = !revealed"
          >
            <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="sm" />
          </OButton>
        </template>
      </OFormInput>
    </div>

    <div v-if="showChannel" class="w-full max-w-160">
      <OFormInput
        name="credentials.channel"
        data-test="slack-channel-input"
        :label="t('alerts.prebuiltDestinations.slackChannel')"
        :help-text="t('alerts.prebuiltDestinations.slackChannelHelp')"
      />
    </div>

    <OBanner
      v-if="showSecretNote"
      variant="warning"
      dense
      icon="lock"
      data-test="slack-webhook-secret-note"
    >
      {{ t("alert_destinations.slackOAuth.webhookSecretNote") }}
    </OBanner>
  </div>
</template>
