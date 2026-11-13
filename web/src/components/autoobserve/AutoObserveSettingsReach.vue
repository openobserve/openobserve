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
  <div class="flex flex-col gap-2" data-test="autoobserve-settings-reach">
    <div v-if="settings.isPending.value" class="flex flex-col gap-2" aria-hidden="true">
      <OSkeleton animation="none" class="h-4 w-3/4" />
      <OSkeleton animation="none" class="h-4 w-1/2" />
    </div>
    <p
      v-else-if="failure"
      class="flex items-start gap-1.5 text-sm"
      :class="failure === 'denied' ? 'text-status-error-text' : 'text-text-secondary'"
      :data-failure="failure"
      data-test="autoobserve-settings-reach-error"
    >
      <OIcon
        :name="failure === 'denied' ? 'lock' : 'info-outline'"
        size="sm"
        class="mt-0.5 shrink-0"
      />
      <span>{{ t(FAILURE_KEY[failure]) }}</span>
    </p>
    <p
      v-else-if="channel"
      class="text-text-body flex items-start gap-1.5 text-sm"
      data-test="autoobserve-settings-reach-channel"
    >
      <OIcon name="tag" size="sm" class="mt-0.5 shrink-0" />
      <span>{{
        t("autoobserve.settingsLive.reach.channel", {
          channel: raw(`#${channel.channel_name}`),
          time: digest,
        })
      }}</span>
    </p>
    <p v-else class="text-text-secondary text-sm" data-test="autoobserve-settings-reach-none">
      {{ t("autoobserve.settingsLive.reach.none") }}
    </p>
    <p
      class="text-text-secondary text-xs leading-relaxed"
      data-test="autoobserve-settings-reach-inbox"
    >
      {{ t("autoobserve.settingsLive.reach.inbox") }}
    </p>
    <OButton
      v-if="failure !== 'denied' && failure !== 'failed'"
      variant="ghost-primary"
      size="xs"
      icon-right="arrow-forward"
      class="-ms-2 self-start"
      data-test="autoobserve-settings-reach-open"
      @click="router.push({ name: 'slack', query: { org_identifier: org } })"
    >
      {{
        channel
          ? t("autoobserve.settingsLive.reach.change")
          : t("autoobserve.settingsLive.reach.setUp")
      }}
    </OButton>
    <OButton
      v-if="failure === 'failed'"
      variant="ghost-primary"
      size="xs"
      class="-ms-2 self-start"
      data-test="autoobserve-settings-reach-retry"
      @click="settings.refetch()"
    >
      {{ t("autoobserve.settingsLive.retry") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { slackInsightsSettingsQuery } from "@/services/slack.queries";
import { statusOf } from "./live/liveCopy";

type ReachFailure = "off" | "denied" | "failed";

const FAILURE_KEY: Record<ReachFailure, I18nKey> = {
  off: "autoobserve.settingsLive.reach.off",
  denied: "autoobserve.settingsLive.reach.denied",
  failed: "autoobserve.settingsLive.reach.failed",
};

const { t, locale } = useI18nTyped();
const router = useRouter();
const org = useOrgId();
const settings = useQuery(() => ({ ...slackInsightsSettingsQuery(org.value), retry: false }));

// A 404 means Slack is not set up here, which is a state to explain, not a failure.
const failure = computed<ReachFailure | null>(() => {
  if (!settings.isError.value) return null;
  const status = statusOf(settings.error.value);
  if (status === 404) return "off";
  if (status === 403) return "denied";
  return "failed";
});

const channel = computed(() => settings.data.value?.channel ?? null);
// The digest time is in the Slack setting's own zone, which may not be the reader's, so it names it.
const zoneName = (zone: string | null | undefined) => {
  if (!zone) return "";
  try {
    const parts = new Intl.DateTimeFormat(locale.value, { timeZone: zone, timeZoneName: "short" });
    return parts.formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
};
const digest = computed(() => {
  const data = settings.data.value;
  return raw([data?.digest_time ?? "", zoneName(data?.digest_time_zone)].filter(Boolean).join(" "));
});
</script>
