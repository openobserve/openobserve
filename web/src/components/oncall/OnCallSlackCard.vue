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
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-slack-card"
  >
    <span class="flex items-center gap-2">
      <img :src="slackLogo" alt="" class="size-4" />
      <OText variant="panel-title">{{ t("oncall.mineSlackTitle") }}</OText>
    </span>

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
      {{ t("oncall.mineSlackNotSetUp") }}
    </OText>
    <template v-else-if="links.data.value">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { useTheme } from "@/composables/useTheme";
import OText from "@/lib/core/Typography/OText.vue";
import { slackMyLinksQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const { t } = useI18nTyped();
const store = useStore();
const { isDark } = useTheme();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const email = computed<string>(() => store.state.userInfo?.email ?? "");
// My on-call shows this card only while Slack is on.
const links = useQuery(() => Object.assign(slackMyLinksQuery(org.value), { enabled: !!org.value }));

const slackLogo = computed(() =>
  getImageURL(isDark.value ? "images/common/slack_dark.svg" : "images/common/slack.svg"),
);

/** The page's Refresh: reads the link again, so a link just made in Slack shows. */
async function refresh() {
  await links.refetch();
}

defineExpose({ refresh });
</script>
