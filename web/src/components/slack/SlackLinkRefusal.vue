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
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { SlackLinkRefusal } from "@/utils/slackLink";
import SlackLinkCard from "./SlackLinkCard.vue";

const props = defineProps<{
  refusal: SlackLinkRefusal;
  canResend: boolean;
  canRetry: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{ resend: []; retry: [] }>();

const { t } = useI18nTyped();

interface RefusalCopy {
  illustration: IllustrationName;
  title: I18nText;
  description?: I18nText;
  resend: boolean;
  retry: boolean;
}

const copy = computed<RefusalCopy>(() => {
  const server = props.refusal.message ? raw(props.refusal.message) : null;
  switch (props.refusal.kind) {
    case "expired":
      return {
        illustration: "hourglass",
        title: t("slackApp.link.expiredTitle"),
        description: t("slackApp.link.expiredDetail"),
        resend: props.canResend,
        retry: false,
      };
    case "unknown":
      return {
        illustration: "hourglass",
        title: t("slackApp.link.expiredTitle"),
        description: t("slackApp.link.unknownDetail"),
        resend: false,
        retry: false,
      };
    case "noAccess":
      // The server's sentence names the workspace, so it replaces the generic title instead of repeating it.
      return {
        illustration: "lock",
        title: server ?? t("slackApp.link.noAccessTitle"),
        description: server ? undefined : t("slackApp.link.noAccessDetail"),
        resend: false,
        retry: false,
      };
    case "wrongAccount":
      return {
        illustration: "users",
        title: t("slackApp.link.wrongAccountTitle"),
        description: server ?? t("slackApp.link.wrongAccountDetail"),
        resend: false,
        retry: props.canRetry,
      };
    case "rateLimited":
      return {
        illustration: "hourglass",
        title: t("slackApp.link.rateLimitedTitle"),
        description: t("slackApp.link.rateLimitedDetail"),
        resend: false,
        retry: props.canRetry,
      };
    default:
      return {
        illustration: "broken-panel",
        title: t("slackApp.link.failedTitle"),
        description: t("slackApp.link.failedDetail"),
        resend: false,
        retry: props.canRetry,
      };
  }
});

const helpContact = computed<I18nText>(() =>
  props.refusal.helpContact
    ? t("slackApp.link.helpContact", { contact: raw(props.refusal.helpContact) })
    : t("slackApp.link.helpContactDefault"),
);
</script>

<template>
  <SlackLinkCard
    :illustration="copy.illustration"
    :title="copy.title"
    :description="copy.description"
    :data-test="`slack-link-state-${refusal.kind}`"
  >
    <template v-if="copy.resend || copy.retry" #actions>
      <OButton
        v-if="copy.resend"
        variant="primary"
        size="sm-action"
        :loading="busy"
        data-test="slack-link-resend"
        @click="emit('resend')"
      >
        {{ t("slackApp.link.sendNewLink") }}
      </OButton>
      <OButton
        v-if="copy.retry"
        variant="primary"
        size="sm-action"
        :loading="busy"
        data-test="slack-link-retry"
        @click="emit('retry')"
      >
        {{ t("slackApp.link.tryAgain") }}
      </OButton>
    </template>
    <template v-if="refusal.kind === 'noAccess'" #extra>
      <p class="text-text-secondary text-sm" data-test="slack-link-help-contact">
        {{ helpContact }}
      </p>
    </template>
  </SlackLinkCard>
</template>
