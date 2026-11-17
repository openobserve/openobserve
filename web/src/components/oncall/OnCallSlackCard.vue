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
  <OnCallReachRow
    :label="t('oncall.mineSlackTitle')"
    :icon-src="slackLogo"
    data-test="oncall-slack-card"
  >
    <template #value>
      <!-- A failed read is not "Not linked": that would send a linked person to link again. -->
      <OText v-if="links.isError.value" variant="meta" data-test="oncall-slack-load-failed">
        {{ t("oncall.mineSlackLoadFailed") }}
      </OText>
      <!-- SA-8: no workspace serves this org, so no link can page the reader. -->
      <OText
        v-else-if="links.data.value && !links.data.value.slack_serves_org"
        variant="meta"
        data-test="oncall-slack-not-set-up"
      >
        {{ t("oncall.phoneNotAvailable") }}
      </OText>
      <template v-else-if="links.data.value">
        <OTruncatedText
          v-if="links.data.value.links.length"
          class="text-text-body text-sm"
          data-test="oncall-slack-linked"
        >
          {{ raw(links.data.value.links.map((link) => link.team_name).join(", ")) }}
        </OTruncatedText>
        <OText v-else variant="meta" data-test="oncall-slack-not-linked">
          {{ t("oncall.mineSlackLinkHow") }}
        </OText>
      </template>
    </template>

    <template v-if="links.data.value && !links.isError.value" #status>
      <OTag
        v-if="!links.data.value.slack_serves_org"
        variant="default-soft"
        size="sm"
        data-test="oncall-slack-state"
      >
        {{ t("oncall.reachNotSetUp") }}
      </OTag>
      <OTag
        v-else-if="links.data.value.links.length"
        variant="success-soft"
        size="sm"
        data-test="oncall-slack-state"
      >
        {{ t("oncall.reachLinked") }}
      </OTag>
      <OTag v-else variant="default-soft" size="sm" data-test="oncall-slack-state">
        {{ t("oncall.reachNotLinked") }}
      </OTag>
    </template>

    <template v-if="links.data.value && !links.data.value.slack_serves_org" #action>
      <OButton
        v-if="admin"
        variant="outline"
        size="xs"
        data-test="oncall-slack-settings-link"
        @click="openSlackSettings"
      >
        <OIcon name="settings" size="sm" />{{ t("oncall.reachSetUp") }}
        <OTooltip :content="t('oncall.mineSlackSetUpHint')" />
      </OButton>
      <OnCallHint v-else :hint="t('oncall.mineSlackAskAdmin')" data-test="oncall-slack-ask-admin" />
    </template>
  </OnCallReachRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { useRouter } from "vue-router";

import OnCallHint from "@/components/oncall/OnCallHint.vue";
import OnCallReachRow from "@/components/oncall/OnCallReachRow.vue";
import { useTheme } from "@/composables/useTheme";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
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
