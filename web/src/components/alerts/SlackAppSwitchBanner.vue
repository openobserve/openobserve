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
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useOncallRoomNames, useSlackAppSwitch } from "@/composables/slack/useSlackAppSwitch";
import { slackInstallationsQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { readSlackOrgConfig } from "@/utils/slackSettings";
import { switchCandidates } from "@/utils/slackAppDestination";

const props = defineProps<{
  destination: { name: string; [key: string]: any };
}>();
const emit = defineEmits<{ switched: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const slackEnabled = computed(() => readSlackOrgConfig(store.state.zoConfig).enabled);

const installations = useQuery(() =>
  Object.assign(slackInstallationsQuery(org.value, { silentForbidden: true }), {
    enabled: slackEnabled.value && !!org.value,
  }),
);

const rooms = useOncallRoomNames(slackEnabled);

// The workspace this webhook posts to, once this org is connected to it.
const installationId = computed(() => {
  if (rooms.value.has(props.destination.name)) return null;
  for (const inst of installations.data.value?.installations ?? []) {
    if (inst.status === "revoked" || inst.status === "pending") continue;
    if (switchCandidates([props.destination], inst.team_id).length) return inst.id;
  }
  return null;
});

const { pending, switchOne } = useSlackAppSwitch();

const run = async () => {
  if (installationId.value && (await switchOne(props.destination, installationId.value))) {
    emit("switched");
  }
};
</script>

<template>
  <OBanner v-if="installationId" variant="info" icon="sync" data-test="slack-app-switch-banner">
    <div class="flex flex-col gap-0.5">
      <span class="font-medium">
        {{ t("slackApp.destination.switchToApp", { product: raw("Slack") }) }}
      </span>
      <span class="text-xs">
        {{ t("slackApp.destination.switchThisDetail", { product: raw("Slack") }) }}
      </span>
    </div>
    <template #actions>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="pending.has(destination.name)"
        data-test="slack-app-switch-this"
        @click="run"
      >
        {{ t("slackApp.destination.switchThis") }}
      </OButton>
    </template>
  </OBanner>
</template>
