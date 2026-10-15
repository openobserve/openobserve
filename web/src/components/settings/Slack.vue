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
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { slackInstallationsQuery, slackPrerequisitesQuery } from "@/services/slack.queries";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { InstallationView, SlackInstallConfirmation as Confirmation } from "@/types/slack";
import { readSlackOrgConfig, slackDisabledVariable } from "@/utils/slackSettings";
import SlackChannelDefaults from "./SlackChannelDefaults.vue";
import SlackConnectEmpty from "./SlackConnectEmpty.vue";
import SlackInstallConfirmation from "./SlackInstallConfirmation.vue";
import SlackLinkingSection from "./SlackLinkingSection.vue";
import SlackPrerequisites from "./SlackPrerequisites.vue";
import SlackSelfHostedWizard from "./SlackSelfHostedWizard.vue";
import SlackUninstallDialog from "./SlackUninstallDialog.vue";
import SlackWorkspaceCard from "./SlackWorkspaceCard.vue";

type DialogMode = "disconnect" | "uninstall";

const { t } = useI18nTyped();
const store = useStore();
const { isMetaOrg } = useIsMetaOrg();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const isCloud = computed(() => config.isCloud == "true");
const selfHostedEnterprise = computed(() => config.isEnterprise == "true" && !isCloud.value);
const slackState = computed(() => readSlackOrgConfig(store.state.zoConfig));

const disabledReason = computed(() => {
  const reason = slackState.value.reason;
  if (!selfHostedEnterprise.value || slackState.value.enabled) return null;
  return reason === "flag" || reason === "master_key" || reason === "home_region_unset"
    ? reason
    : null;
});
const otherRegion = computed(
  () =>
    selfHostedEnterprise.value &&
    !slackState.value.enabled &&
    slackState.value.reason === "other_region",
);
const disabledVariable = computed(() => slackDisabledVariable(disabledReason.value) ?? "");

const disabledCopy = computed<{ title: I18nText; description: I18nText } | null>(() => {
  const variable = disabledVariable.value;
  switch (disabledReason.value) {
    case "flag":
      return {
        title: t("slackApp.disabled.flagTitle"),
        description: t("slackApp.disabled.flagDescription", { variable }),
      };
    case "master_key":
      return {
        title: t("slackApp.disabled.masterKeyTitle"),
        description: t("slackApp.disabled.masterKeyDescription", { variable }),
      };
    case "home_region_unset":
      return {
        title: t("slackApp.disabled.homeRegionTitle"),
        description: t("slackApp.disabled.homeRegionDescription", { variable }),
      };
    default:
      return null;
  }
});

// With the flag off only `_meta` Admins may read the checks; with master_key org Admins may too.
const prereqEligible = computed(
  () =>
    disabledReason.value === "master_key" || (disabledReason.value === "flag" && isMetaOrg.value),
);
const prerequisites = useQuery(() =>
  Object.assign(slackPrerequisitesQuery(org.value, { silentForbidden: true }), {
    enabled: prereqEligible.value && !!org.value,
  }),
);

const installations = useQuery(() =>
  Object.assign(slackInstallationsQuery(org.value), {
    enabled: slackState.value.enabled && !!org.value,
  }),
);
const forbidden = computed(() => {
  const err = installations.error.value as { response?: { status?: number } } | null;
  return err?.response?.status === 403;
});
const current = computed<InstallationView | null>(
  () => installations.data.value?.installations?.[0] ?? null,
);

const wizardActive = ref(false);
const confirmation = ref<Confirmation | null>(null);
const dialogMode = ref<DialogMode>("uninstall");
const dialogOpen = ref(false);
// The dialog keeps its own copy: its result outlives the installation it removed.
const dialogInstallation = ref<InstallationView | null>(null);

// A pending install keeps the wizard up past its own install step, until the wizard says done.
watch(
  () => [org.value, current.value?.status] as const,
  ([orgId, status], previous) => {
    if (previous && previous[0] !== orgId) {
      wizardActive.value = false;
      confirmation.value = null;
      dialogOpen.value = false;
      dialogInstallation.value = null;
    }
    if (status === "pending") wizardActive.value = true;
  },
  { immediate: true },
);
const showWizard = computed(() => !isCloud.value && wizardActive.value);

const openDialog = (mode: DialogMode): void => {
  if (!current.value) return;
  dialogMode.value = mode;
  dialogInstallation.value = current.value;
  dialogOpen.value = true;
};
</script>

<template>
  <div class="flex flex-col gap-6 pb-6" data-test="slack-settings">
    <template v-if="disabledCopy">
      <OCard variant="outlined" data-test="slack-disabled">
        <OEmptyState
          size="block"
          illustration="lock"
          :title="disabledCopy.title"
          :description="disabledCopy.description"
          :backdrop="false"
        />
      </OCard>
      <OCard
        v-if="prerequisites.data.value"
        variant="outlined"
        class="gap-4 p-5"
        data-test="slack-disabled-step0"
      >
        <div class="flex flex-col gap-1">
          <h2 class="text-text-heading m-0 text-lg font-semibold">
            {{ t("slackApp.prereq.title") }}
          </h2>
          <p class="text-text-secondary m-0 text-sm">{{ t("slackApp.prereq.subtitle") }}</p>
        </div>
        <SlackPrerequisites
          :checks="prerequisites.data.value.checks"
          :loading="prerequisites.isFetching.value"
          @recheck="prerequisites.refetch()"
        />
      </OCard>
    </template>

    <OCard v-else-if="otherRegion" variant="outlined" data-test="slack-other-region">
      <OEmptyState
        size="block"
        illustration="connect"
        :title="t('slackApp.disabled.otherRegionTitle')"
        :description="
          t('slackApp.disabled.otherRegionDescription', {
            region: slackState.homeRegion ?? '',
          })
        "
        :backdrop="false"
      />
    </OCard>

    <!-- Keyed by org: every step, ticket and popup below belongs to the org it started in. -->
    <div v-else-if="slackState.enabled" :key="org" class="flex flex-col gap-6">
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
        :installation="current"
        @done="wizardActive = false"
        @cancel="wizardActive = false"
      />
      <template v-else-if="current">
        <SlackWorkspaceCard
          :installation="current"
          :is-cloud="isCloud"
          @disconnect="openDialog('disconnect')"
          @uninstall="openDialog('uninstall')"
        >
          <SlackChannelDefaults :installation-id="current.id" />
          <SlackLinkingSection :installation="current" />
        </SlackWorkspaceCard>
      </template>
      <SlackConnectEmpty
        v-else
        :is-cloud="isCloud"
        :available="installations.data.value?.available ?? []"
        :upgrade-candidates="installations.data.value?.upgrade_candidates ?? []"
        @setup="wizardActive = true"
        @installed="confirmation = $event"
      />
    </div>

    <SlackUninstallDialog
      v-if="dialogInstallation"
      v-model:open="dialogOpen"
      :mode="dialogMode"
      :installation="dialogInstallation"
    />
  </div>
</template>
