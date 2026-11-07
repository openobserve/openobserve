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
  <section
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-2"
    data-test="agent-home-dashboards"
  >
    <div class="flex min-h-8 items-baseline justify-between gap-2 ps-1">
      <h2 :id="headingId" class="text-text-heading text-base font-semibold">
        {{ t("home.agent.dashboards.title") }}
      </h2>
      <OButton
        variant="ghost-primary"
        size="sm"
        data-test="agent-home-dashboards-all"
        @click="openAll"
      >
        {{ t("home.agent.dashboards.all") }}
      </OButton>
    </div>
    <OText
      v-if="dashboards.length === 0"
      variant="meta"
      as="p"
      class="ps-1"
      data-test="agent-home-dashboards-none"
    >
      {{ t("home.agent.dashboards.none") }}
    </OText>
    <ul
      v-else
      class="grid min-w-0 grid-cols-1 gap-3 @[40rem]/home:grid-cols-2 @[64rem]/home:grid-cols-4"
    >
      <li v-for="dashboard in dashboards" :key="dashboard.dashboardId" class="min-w-0">
        <OButton
          variant="outline"
          size="sm"
          block
          class="h-auto! min-h-14 flex-col! items-start! gap-0.5 px-3! py-2! text-start font-normal"
          :data-test="`agent-home-dashboard-${dashboard.dashboardId}`"
          @click="open(dashboard)"
        >
          <span class="flex w-full min-w-0 items-center gap-1.5">
            <OIcon name="dashboard" size="sm" class="text-text-secondary shrink-0" />
            <OTruncatedText class="text-text-heading min-w-0 text-sm font-medium">{{
              dashboard.title
            }}</OTruncatedText>
          </span>
          <OText variant="meta">{{
            t("home.agent.dashboards.viewed", { time: raw(formatRelativeCompact(dashboard.at)) })
          }}</OText>
        </OButton>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelativeCompact } from "@/utils/formatters";

import { homeUserKey, readRecentDashboards, type RecentDashboard } from "./homeStorage";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const headingId = `agent-home-dashboards-${useId()}`;

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const email = computed<string>(() => store.state.userInfo?.email ?? "");
const dashboards = ref<RecentDashboard[]>([]);

function reload(): void {
  dashboards.value =
    org.value && email.value ? readRecentDashboards(homeUserKey(email.value, org.value)) : [];
}

watch([org, email], reload, { immediate: true });
// Home is kept alive, so a dashboard opened since the last visit shows on return.
onActivated(reload);

function open(dashboard: RecentDashboard): void {
  void router
    .push({
      name: "viewDashboard",
      query: {
        dashboard: dashboard.dashboardId,
        folder: dashboard.folderId,
        org_identifier: org.value,
      },
    })
    .catch(() => undefined);
}

function openAll(): void {
  void router
    .push({ name: "dashboards", query: { org_identifier: org.value } })
    .catch(() => undefined);
}
</script>
