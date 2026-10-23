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
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useOncallRoomNames, useSlackAppSwitch } from "@/composables/slack/useSlackAppSwitch";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView } from "@/types/slack";
import { switchCandidates } from "@/utils/slackAppDestination";

const props = defineProps<{ installation: InstallationView }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const destinations = useQuery(() => destinationsQuery(org.value, "alert"));
const webhooks = computed(() =>
  switchCandidates(destinations.data.value ?? [], props.installation.team_id),
);
const rooms = useOncallRoomNames(computed(() => webhooks.value.length > 0));
const candidates = computed(() => webhooks.value.filter((d) => !rooms.value.has(d.name)));
const names = computed(() => raw(candidates.value.map((d) => d.name).join(" · ")));

const { pending, switchAll } = useSlackAppSwitch();
const switching = computed(() => pending.value.size > 0);

const review = () =>
  router.push({ name: "alertDestinations", query: { org_identifier: org.value } });

const run = () => switchAll(candidates.value, props.installation.id);
</script>

<template>
  <OBanner
    v-if="candidates.length"
    variant="info"
    icon="sync"
    inline-actions
    data-test="slack-switch-all"
  >
    <div class="flex flex-col gap-1">
      <span>
        <span class="font-semibold">{{
          t("slackApp.switchAll.title", { count: candidates.length }, candidates.length)
        }}</span>
        {{ t("slackApp.switchAll.detail", { product: raw("Slack") }, candidates.length) }}
      </span>
      <span class="text-text-secondary text-xs" data-test="slack-switch-all-names">{{
        names
      }}</span>
    </div>
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="slack-switch-all-review"
        @click="review"
      >
        {{ t("slackApp.switchAll.review") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="switching"
        data-test="slack-switch-all-action"
        @click="run"
      >
        {{ t("slackApp.switchAll.action") }}
      </OButton>
    </template>
  </OBanner>
</template>
