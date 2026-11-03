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

<!-- LN-1: whether the reader's Slack DMs can reach them. It links nothing itself; linking is /o2 link. -->
<template>
  <div class="flex min-h-8 items-center gap-3 py-1" data-test="oncall-slack-card">
    <span class="flex w-16 shrink-0 items-center gap-1.5">
      <img :src="slackLogo" alt="" class="size-4" />
      <OText variant="body">{{ t("oncall.mineSlackTitle") }}</OText>
    </span>

    <!-- A failed read is not "Not linked": that would send a linked person to link again. -->
    <OText
      v-if="links.isError.value"
      variant="meta"
      class="flex-1"
      data-test="oncall-slack-load-failed"
    >
      {{ t("oncall.mineSlackLoadFailed") }}
    </OText>
    <!-- SA-8: no workspace serves this org, so no link can page the reader. -->
    <template v-else-if="links.data.value && !links.data.value.slack_serves_org">
      <span class="flex min-w-0 flex-1 items-center gap-1" data-test="oncall-slack-not-set-up">
        <OText variant="meta">{{ t("oncall.mineSlackNotSetUp") }}</OText>
        <span v-if="!admin" class="inline-flex" data-test="oncall-slack-ask-admin">
          <OIcon name="info" size="sm" class="text-text-secondary" />
          <OTooltip :content="t('oncall.mineSlackAskAdmin')" />
        </span>
      </span>
      <OButton
        v-if="admin"
        variant="outline"
        size="xs"
        data-test="oncall-slack-settings-link"
        @click="openSlackSettings"
      >
        <OIcon name="settings" size="sm" />{{ t("oncall.mineSlackSetUp") }}
      </OButton>
    </template>
    <template v-else-if="links.data.value">
      <span class="flex min-w-0 flex-1 flex-col">
        <OText
          v-for="link in links.data.value.links"
          :key="link.id"
          variant="body"
          :data-test="`oncall-slack-linked-${link.id}`"
        >
          {{ t("oncall.mineSlackLinked", { email: raw(email), workspace: raw(link.team_name) }) }}
        </OText>
        <OText
          v-if="!links.data.value.links.length"
          variant="meta"
          data-test="oncall-slack-not-linked"
        >
          {{ t("oncall.mineSlackNotLinked") }}
        </OText>
      </span>
      <OIcon
        v-if="links.data.value.links.length"
        name="check-circle"
        size="sm"
        class="text-status-success-text shrink-0"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { useRouter } from "vue-router";

import { useTheme } from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { slackMyLinksQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

withDefaults(
  defineProps<{
    /** Whether to offer the Slack settings button rather than "ask an admin"; the server is still the gate. */
    admin?: boolean;
  }>(),
  { admin: false },
);

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { isDark } = useTheme();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const email = computed<string>(() => store.state.userInfo?.email ?? "");
// My on-call shows this card only while Slack is on.
const links = useQuery(() => Object.assign(slackMyLinksQuery(org.value), { enabled: !!org.value }));

const slackLogo = computed(() =>
  getImageURL(isDark.value ? "images/common/slack_dark.svg" : "images/common/slack.svg"),
);

function openSlackSettings() {
  router.push({ name: "slack", query: { org_identifier: org.value } });
}

/** The page's Refresh: reads the link again, so a link just made in Slack shows. */
async function refresh() {
  await links.refetch();
}

defineExpose({ refresh });
</script>
