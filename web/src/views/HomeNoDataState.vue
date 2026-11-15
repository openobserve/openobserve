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

<!--
  HomeNoDataState — empty state for the Home/Usage tab when the org has no ingested data.
  Each card and chip routes to a distinct, real ingestion path in OpenObserve,
  covering logs, traces, metrics, and AI integrations.
-->
<template>
  <OEmptyState v-bind="{ ...shell, ...rootTestAttrs }">
    <template v-if="!alternativesOnly" #text>
      <span v-if="tab" data-test="home-no-data-description">{{ tabDescription }}</span>
      <span v-else v-html="description" />
    </template>

    <template v-if="!alternativesOnly" #actions>
      <div v-if="$slots.status" class="flex basis-full justify-center">
        <slot name="status" />
      </div>
      <OButton variant="primary" data-test="home-no-data-logs-card" @click="setUp('logs', 'curl')">
        {{ t("home.noDataState.logs") }}
      </OButton>
      <OButton data-test="home-no-data-traces-card" @click="setUp('backend', 'tracesOTLP')">
        {{ t("home.noDataState.traces") }}
      </OButton>
      <div v-if="sampleDataFlow" class="flex basis-full justify-center">
        <SampleDataCallout class="max-w-200" />
      </div>
    </template>

    <template #extra>
      <div
        :class="[
          'flex flex-wrap items-center gap-x-4 gap-y-1',
          alternativesOnly ? 'justify-start' : 'justify-center',
        ]"
      >
        <span class="text-text-secondary text-compact">{{ t("home.noDataState.or") }}</span>
        <template v-if="alternativesOnly">
          <OButton variant="link" data-test="home-no-data-logs-card" @click="setUp('logs', 'curl')">
            {{ t("home.noDataState.logs") }}
          </OButton>
          <OButton
            variant="link"
            data-test="home-no-data-traces-card"
            @click="setUp('backend', 'tracesOTLP')"
          >
            {{ t("home.noDataState.traces") }}
          </OButton>
        </template>
        <OButton
          variant="link"
          data-test="home-no-data-metrics-card"
          @click="setUp('infrastructure', 'prometheus')"
        >
          {{ t("home.noDataState.metrics") }}
        </OButton>
        <OButton variant="link" data-test="home-no-data-otel-btn" @click="go('ingestLogsFromOtel')">
          {{ raw("OpenTelemetry") }}
        </OButton>
        <OButton
          variant="link"
          data-test="home-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          {{ raw("Kubernetes") }}
        </OButton>
        <OButton variant="link" data-test="home-no-data-aws-btn" @click="go('AWSConfig')">
          {{ t("home.noDataState.aws") }}
        </OButton>
        <OButton variant="link" data-test="home-no-data-ai-btn" @click="go('ai-integrations')">
          {{ t("home.noDataState.aiIntegrations") }}
        </OButton>
        <OButton variant="link" data-test="home-no-data-shippers-btn" @click="go('ingestLogs')">
          {{ t("home.noDataState.shippers") }}
        </OButton>
        <OButton
          v-if="store.state.zoConfig?.profiling_enabled"
          variant="link"
          :disabled="profilesLocked"
          :disabled-reason="profilesLocked ? profilesLockedReason : undefined"
          data-test="home-no-data-profiles-btn"
          @click="go('ingestProfiles')"
        >
          {{ t("home.noDataState.profiles") }}
        </OButton>
        <OButton
          v-if="tab"
          variant="link"
          data-test="home-no-data-all-sources-link"
          @click="go('recommended')"
        >
          {{ t("home.noDataState.allSources") }}
        </OButton>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import SampleDataCallout from "@/components/sampleData/SampleDataCallout.vue";
import { sampleDataOffered } from "@/utils/firstRunFlow";
import { useSetupTarget } from "@/composables/useSetupTarget";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";
import { useLicenseLock } from "@/composables/useFeatureLock";
import DOMPurify from "dompurify";

const props = defineProps<{
  /** The Home tab the onboarding block stands in for; unset keeps the flag-off Usage empty state. */
  tab?: "overview" | "usage";
  /** Under FirstDataPanel's card: only the cards and chips, under an "Or start another way" caption. */
  alternativesOnly?: boolean;
  /** The flag-off Overview, which names only what every edition's Overview shows. */
  flagOff?: boolean;
}>();

defineSlots<{
  /** A line between the description and the cards. */
  status?(): unknown;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { locked: profilesLocked, lockedReason: profilesLockedReason } =
  useLicenseLock("continuous_profiling");

const shell = computed(() => {
  if (props.alternativesOnly)
    return { size: "compact" as const, title: t("ingestion.firstDataPanel.anotherWay") };
  if (props.tab)
    return {
      icon: "link" as const,
      title: t("logs.noData.title", { product: raw("OpenObserve") }),
    };
  return { icon: "bar-chart" as const, title: t("home.noDataState.title") };
});
// an unset data-test would also erase OEmptyState's own id on the flag-off page
const rootTestAttrs = computed((): Record<string, string> => {
  if (!props.tab) return {};
  return {
    "data-test": props.alternativesOnly ? "home-first-data-alternatives" : "home-first-data-hero",
  };
});
// Cloud identifiers are random strings; a selection set from the URL carries no label, so the org list names it
const orgName = computed<string>(() => {
  const id: string = store.state.selectedOrganization?.identifier ?? "";
  return (
    store.state.selectedOrganization?.label ||
    (store.state.organizations ?? []).find(
      (o: { identifier?: string; name?: string }) => o?.identifier === id,
    )?.name ||
    id
  );
});
const tabDescription = computed(() => {
  const org = raw(orgName.value);
  if (props.tab === "usage") return t("home.noDataState.descriptionUsage", { org });
  if (props.flagOff) return t("home.noDataState.descriptionOverviewFlagOff", { org });
  return t("home.noDataState.descriptionOverview", { org });
});

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

const sampleDataFlow = computed(() =>
  sampleDataOffered(
    store.state.zoConfig,
    store.state.organizationData?.organizationSettings?.free_trial_expiry,
  ),
);

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => DOMPurify.sanitize(t("home.noDataState.description")));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
// the three main cards start onboarding on cloud for an org with no data
const { target } = useSetupTarget();
const setUp = (choice: OnboardingChoiceId, routeName: string) => {
  void router.push(target(choice, routeName));
};
</script>
