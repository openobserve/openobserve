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
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import config from "@/aws-exports";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { slackInstallationsQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView, SlackInstallConfirmation as Confirmation } from "@/types/slack";
import { orderInstallations, readSlackOrgConfig } from "@/utils/slackSettings";
import SlackChannelDefaults from "./SlackChannelDefaults.vue";
import SlackConnectEmpty from "./SlackConnectEmpty.vue";
import SlackInstallConfirmation from "./SlackInstallConfirmation.vue";
import SlackLinkingSection from "./SlackLinkingSection.vue";
import SlackOrgAccess from "./SlackOrgAccess.vue";
import SlackSelfHostedWizard from "./SlackSelfHostedWizard.vue";
import SlackSwitchAllCard from "./SlackSwitchAllCard.vue";
import SlackUninstallDialog from "./SlackUninstallDialog.vue";
import SlackWorkspaceCard from "./SlackWorkspaceCard.vue";

type DialogMode = "disconnect" | "uninstall";

const { t } = useI18nTyped();
const store = useStore();
const { isMetaOrg } = useIsMetaOrg();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const isCloud = computed(() => config.isCloud == "true");
const slackState = computed(() => readSlackOrgConfig(store.state.zoConfig));

const installations = useQuery(() =>
  Object.assign(slackInstallationsQuery(org.value), {
    enabled: slackState.value.enabled && !!org.value,
  }),
);
const forbidden = computed(() => {
  const err = installations.error.value as { response?: { status?: number } } | null;
  return err?.response?.status === 403;
});
const ordered = computed(() => orderInstallations(installations.data.value?.installations ?? []));
const selectedId = ref<string | null>(null);
const current = computed<InstallationView | null>(
  () => ordered.value.find((i) => i.id === selectedId.value) ?? ordered.value[0] ?? null,
);
const selectedTab = computed<string>({
  get: () => current.value?.id ?? "",
  set: (id) => (selectedId.value = id),
});
const pendingId = computed(() => ordered.value.find((i) => i.status === "pending")?.id ?? null);
const showOrgAccess = computed(() => isMetaOrg.value && current.value?.scope === "instance");

const wizardActive = ref(false);
const wizardInstallationId = ref<string | null>(null);
const adding = ref(false);
const confirmation = ref<Confirmation | null>(null);
const dialogMode = ref<DialogMode>("uninstall");
const dialogOpen = ref(false);
// The dialog keeps its own copy: its result outlives the installation it removed.
const dialogInstallation = ref<InstallationView | null>(null);

// A pending install keeps the wizard up past its own install step, until the wizard says done.
watch(
  () => [org.value, pendingId.value] as const,
  ([orgId, pending], previous) => {
    if (previous && previous[0] !== orgId) {
      wizardActive.value = false;
      wizardInstallationId.value = null;
      adding.value = false;
      selectedId.value = null;
      confirmation.value = null;
      dialogOpen.value = false;
      dialogInstallation.value = null;
    }
    if (pending) {
      wizardActive.value = true;
      wizardInstallationId.value = pending;
    }
  },
  { immediate: true },
);
const showWizard = computed(() => !isCloud.value && wizardActive.value);
// Pinned by id so the wizard keeps its installation after it stops being pending.
const wizardInstallation = computed(
  () => ordered.value.find((i) => i.id === wizardInstallationId.value) ?? null,
);

const closeWizard = (done: boolean): void => {
  if (done && wizardInstallationId.value) selectedId.value = wizardInstallationId.value;
  wizardActive.value = false;
  wizardInstallationId.value = null;
  adding.value = false;
};

const showConfirmation = (value: Confirmation): void => {
  adding.value = false;
  confirmation.value = value;
};

const openDialog = (mode: DialogMode): void => {
  if (!current.value) return;
  dialogMode.value = mode;
  dialogInstallation.value = current.value;
  dialogOpen.value = true;
};
</script>

<template>
  <div class="flex flex-col gap-6 pb-6" data-test="slack-settings">
    <!-- Keyed by org: every step, ticket and popup below belongs to the org it started in. -->
    <div v-if="slackState.enabled" :key="org" class="flex flex-col gap-6">
      <div v-if="installations.isPending.value" class="flex justify-center py-16">
        <OSpinner size="md" />
      </div>
      <OEmptyState
        v-else-if="forbidden"
        size="hero"
        preset="no-access"
        data-test="slack-no-access"
      />
      <OEmptyState
        v-else-if="installations.isError.value"
        size="block"
        preset="load-error"
        data-test="slack-load-error"
        @action="installations.refetch()"
      />
      <SlackInstallConfirmation
        v-else-if="confirmation"
        :confirmation="confirmation"
        @continue="confirmation = null"
      />
      <SlackSelfHostedWizard
        v-else-if="showWizard"
        :installation="wizardInstallation"
        @done="closeWizard(true)"
        @cancel="closeWizard(false)"
      />
      <template v-else-if="current && !adding">
        <div
          class="flex items-end justify-between gap-3"
          :class="ordered.length > 1 ? 'border-border-default border-b' : ''"
        >
          <OTabs
            v-if="ordered.length > 1"
            v-model="selectedTab"
            class="min-w-0"
            data-test="slack-workspace-tabs"
          >
            <OTab
              v-for="inst in ordered"
              :key="inst.id"
              :name="inst.id"
              data-test="slack-workspace-tab"
            >
              <span class="inline-flex items-center gap-2">
                {{ raw(inst.team_name) }}
                <OTag
                  v-if="inst.scope === 'instance'"
                  variant="primary-soft"
                  size="sm"
                  :label="t('slackApp.card.instanceTag')"
                />
              </span>
            </OTab>
          </OTabs>
          <OButton
            variant="outline"
            size="sm-action"
            class="ms-auto"
            data-test="slack-add-workspace"
            @click="adding = true"
          >
            {{ t("slackApp.workspaces.addAnother") }}
          </OButton>
        </div>
        <SlackSwitchAllCard :key="`switch-${current.id}`" :installation="current" />
        <SlackWorkspaceCard
          :key="current.id"
          :installation="current"
          :is-cloud="isCloud"
          @disconnect="openDialog('disconnect')"
          @uninstall="openDialog('uninstall')"
        >
          <SlackOrgAccess v-if="showOrgAccess" :installation="current" />
          <SlackChannelDefaults :installation-id="current.id" />
          <SlackLinkingSection :installation="current" />
        </SlackWorkspaceCard>
      </template>
      <template v-else>
        <div v-if="adding" class="flex justify-end">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="slack-add-workspace-cancel"
            @click="adding = false"
          >
            {{ t("common.cancel") }}
          </OButton>
        </div>
        <SlackConnectEmpty
          :is-cloud="isCloud"
          :available="installations.data.value?.available ?? []"
          :upgrade-candidates="installations.data.value?.upgrade_candidates ?? []"
          @setup="wizardActive = true"
          @installed="showConfirmation"
        />
      </template>
    </div>

    <SlackUninstallDialog
      v-if="dialogInstallation"
      v-model:open="dialogOpen"
      :mode="dialogMode"
      :installation="dialogInstallation"
    />
  </div>
</template>
