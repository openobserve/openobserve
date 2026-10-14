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
  <OContent y class="min-h-0 flex-1 overflow-auto" data-test="autoobserve-policy">
    <div class="flex flex-col gap-4">
      <OBanner variant="info" icon="info-outline" dense data-test="autoobserve-policy-defaults">
        {{ t("autoobserve.policy.defaultsNote") }}
      </OBanner>

      <div ref="tabsRoot" class="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        <OTabs
          :model-value="tabName(section)"
          orientation="vertical"
          class="w-full shrink-0 md:w-60"
          data-test="autoobserve-policy-tabs"
          @update:model-value="select"
        >
          <OTab
            v-for="tab in tabs"
            :key="tab.key"
            :name="tabName(tab.key)"
            :data-test="`autoobserve-policy-tab-${tab.key}`"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5 text-start">
              <span class="flex items-center gap-1.5">
                {{ tab.label }}
                <OTag
                  v-if="tab.key === 'fixes'"
                  variant="purple-soft"
                  size="xs"
                  :label="t('autoobserve.phase2')"
                />
              </span>
              <span
                class="max-w-full truncate text-xs"
                :class="{ 'text-text-secondary': section !== tab.key }"
                :data-test="`autoobserve-policy-tab-${tab.key}-summary`"
                >{{ tab.summary }}</span
              >
            </span>
          </OTab>
        </OTabs>

        <OTabPanels :model-value="tabName(section)" keep-alive class="min-w-0 flex-1">
          <OTabPanel
            v-for="tab in tabs"
            :key="tab.key"
            :name="tabName(tab.key)"
            layout="flex-col"
            content-class="gap-4"
          >
            <OFormSection
              v-for="group in groups.filter((g) => g.section === tab.key)"
              :key="group.key"
              :title="group.title"
              :data-test="`autoobserve-policy-${group.key}`"
            >
              <template v-if="group.key === 'action'" #actions>
                <OTag variant="purple-soft" size="xs" :label="t('autoobserve.phase2')" />
              </template>
              <p class="text-text-secondary py-1 text-xs">{{ group.hint }}</p>
              <OSettingRow
                v-for="cls in group.classes"
                :key="cls.id"
                :disabled="group.key === 'action'"
                :label="raw(cls.id)"
                :description="classDescription(cls.id)"
                :data-test="`autoobserve-policy-${cls.id}`"
              >
                <OTag
                  :variant="MODE_VARIANT[cls.mode]"
                  size="sm"
                  :label="t(MODE_LABEL[cls.mode])"
                />
              </OSettingRow>
            </OFormSection>

            <OCard
              v-if="tab.key === 'fixes'"
              variant="outlined"
              data-test="autoobserve-policy-outcomes"
            >
              <OCardSection role="header">
                <OIcon name="trending-up" size="sm" class="text-text-secondary" />
                <OText variant="panel-title">{{ t("autoobserve.policy.outcomesTitle") }}</OText>
                <OTag
                  class="ms-auto"
                  variant="purple-soft"
                  size="xs"
                  :label="t('autoobserve.phase2')"
                />
              </OCardSection>
              <OCardSection role="body" class="flex flex-col gap-2 pt-0">
                <p class="text-text-body text-sm">{{ t("autoobserve.policy.outcomesBody") }}</p>
                <p class="text-text-secondary text-xs">
                  {{ t("autoobserve.policy.outcomesExample") }}
                </p>
              </OCardSection>
            </OCard>

            <template v-if="tab.key === 'investigation'">
              <OFormSection
                :title="t('autoobserve.policy.investigation')"
                data-test="autoobserve-policy-triage"
              >
                <p class="text-text-secondary py-1 text-xs">
                  {{ t("autoobserve.policy.triageHint") }}
                </p>
                <OSettingRow
                  v-for="row in triageRows"
                  :key="row.key"
                  :label="row.label"
                  :description="row.description"
                  :data-test="`autoobserve-policy-triage-${row.key}`"
                >
                  <OTag :variant="row.variant" size="sm" :label="row.mode" />
                </OSettingRow>
              </OFormSection>

              <OFormSection
                :title="t('autoobserve.policy.paging')"
                data-test="autoobserve-policy-paging"
              >
                <p class="text-text-secondary py-1 text-xs">
                  {{ t("autoobserve.policy.pagingHint") }}
                </p>
                <OSettingRow
                  v-for="row in routingRows"
                  :key="row.key"
                  :label="row.label"
                  :description="row.description"
                  :data-test="`autoobserve-policy-routing-${row.key}`"
                >
                  <OTag :variant="row.variant" size="sm" :label="row.mode" />
                </OSettingRow>
              </OFormSection>
            </template>

            <OFormSection
              v-if="tab.key === 'channels'"
              :title="t('autoobserve.policy.channels')"
              data-test="autoobserve-policy-channels"
            >
              <OSettingRow
                v-for="c in channels"
                :key="c.key"
                :label="c.label"
                :description="c.description"
                :data-test="`autoobserve-policy-channel-${c.key}`"
              >
                <OTag :variant="c.variant" size="sm" :label="c.state" />
              </OSettingRow>
            </OFormSection>
          </OTabPanel>
        </OTabPanels>
      </div>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { CHANNELS, actionClassesFor, type PolicyMode } from "./fixtures";
import { useAutonomy, useCompletedFixes } from "./v2/useDecisions";
import { recordFor, say } from "./v2/fixtures";
import { AUTONOMY } from "./data/facts";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();

const SECTIONS = ["coverage", "alerts", "fixes", "investigation", "channels"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, I18nKey> = {
  coverage: "autoobserve.policy.nav.coverage",
  alerts: "autoobserve.policy.nav.alerts",
  fixes: "autoobserve.policy.nav.fixes",
  investigation: "autoobserve.policy.nav.investigation",
  channels: "autoobserve.policy.nav.channels",
};
const MODE_ORDER: PolicyMode[] = ["auto", "suggest", "off"];

const CLASS_DESC: Record<string, I18nKey> = {
  EnableDeduplication: "autoobserve.policy.classes.EnableDeduplication",
  CreateDetector: "autoobserve.policy.classes.CreateDetector",
  RaiseThreshold: "autoobserve.policy.classes.RaiseThreshold",
  LowerThreshold: "autoobserve.policy.classes.LowerThreshold",
  LengthenEvaluationWindow: "autoobserve.policy.classes.LengthenEvaluationWindow",
  FixAlertQuery: "autoobserve.policy.classes.FixAlertQuery",
  AttachDestination: "autoobserve.policy.classes.AttachDestination",
  AddLibraryAlert: "autoobserve.policy.classes.AddLibraryAlert",
  MoveToIncidentDelivery: "autoobserve.policy.classes.MoveToIncidentDelivery",
  ReviewForDeletion: "autoobserve.policy.classes.ReviewForDeletion",
  RollbackDeploy: "autoobserve.policy.classes.RollbackDeploy",
  ScaleService: "autoobserve.policy.classes.ScaleService",
  RestartPod: "autoobserve.policy.classes.RestartPod",
  RevertConfigChange: "autoobserve.policy.classes.RevertConfigChange",
  EvictLeakedConnections: "autoobserve.policy.classes.EvictLeakedConnections",
  AbortRollout: "autoobserve.policy.classes.AbortRollout",
  ScaleQueueWorkers: "autoobserve.policy.classes.ScaleQueueWorkers",
  ToggleFeatureFlag: "autoobserve.policy.classes.ToggleFeatureFlag",
  RunRunbookStep: "autoobserve.policy.classes.RunRunbookStep",
};
const MODE_LABEL: Record<PolicyMode, I18nKey> = {
  off: "autoobserve.policy.off",
  suggest: "autoobserve.policy.suggest",
  auto: "autoobserve.policy.auto",
};
const MODE_VARIANT: Record<PolicyMode, BadgeVariant> = {
  off: "default-soft",
  suggest: "warning-soft",
  auto: "blue-soft",
};
const autonomy = useAutonomy();
const completedFixes = useCompletedFixes();
const classes = computed(() => actionClassesFor(autonomy));

// Classes with a track record show it, including fixes the viewer approved on the page.
const classDescription = (id: string) => {
  const fact = AUTONOMY.find((a) => a.actionClass === id);
  const description = t(CLASS_DESC[id]);
  if (!fact || fact.kind === "retune") return description;
  return raw(`${description} ${say(t, recordFor(fact, completedFixes.value[fact.kind]))}`);
};

const groups = computed(() => [
  {
    key: "coverage",
    section: "coverage" as Section,
    title: t("autoobserve.policy.groupCoverage"),
    hint: t("autoobserve.policy.groupCoverageHint"),
    classes: classes.value.filter((c) => c.group === "coverage"),
  },
  {
    key: "calibration",
    section: "alerts" as Section,
    title: t("autoobserve.policy.groupCalibration"),
    hint: t("autoobserve.policy.gateHint"),
    classes: classes.value.filter((c) => c.group === "calibration"),
  },
  {
    key: "action",
    section: "fixes" as Section,
    title: t("autoobserve.policy.phase2Title"),
    hint: t("autoobserve.policy.phase2Hint"),
    classes: classes.value.filter((c) => c.group === "action"),
  },
]);

const triageRows = computed(() => [
  {
    key: "p1",
    label: t("alerts.incidents.severityP1"),
    short: t("autoobserve.policy.triage.p1Short"),
    description: t("autoobserve.policy.triage.p1Desc"),
    mode: t("autoobserve.policy.triage.parallel"),
    variant: "default-soft" as BadgeVariant,
  },
  {
    key: "p2-p4",
    label: t("autoobserve.policy.triage.p2p4"),
    short: t("autoobserve.policy.triage.p2p4"),
    description: t("autoobserve.policy.triage.gateDesc"),
    mode: t("autoobserve.policy.triage.gate"),
    variant: "blue-soft" as BadgeVariant,
  },
]);

const routingRows = computed(() => [
  {
    key: "p1-p2",
    label: t("autoobserve.policy.routing.p1p2"),
    description: t("autoobserve.policy.routing.p1p2Desc"),
    mode: t("autoobserve.policy.routing.page"),
    variant: "error-soft" as BadgeVariant,
  },
  {
    key: "p3",
    label: t("autoobserve.policy.routing.p3"),
    description: t("autoobserve.policy.routing.p3Desc"),
    mode: t("autoobserve.policy.routing.message"),
    variant: "warning-soft" as BadgeVariant,
  },
  {
    key: "p4",
    label: t("autoobserve.policy.routing.p4"),
    description: t("autoobserve.policy.routing.p4Desc"),
    mode: t("autoobserve.policy.routing.summary"),
    variant: "default-soft" as BadgeVariant,
  },
]);

const channels = computed(() => [
  {
    key: "inbox",
    label: t("autoobserve.policy.channelInbox"),
    description: t("autoobserve.policy.channelDefault"),
    state: t("autoobserve.policy.alwaysOn"),
    variant: "success-soft" as BadgeVariant,
  },
  {
    key: "email-admins",
    label: t("autoobserve.policy.channelEmailAdmins"),
    description: t("autoobserve.policy.channelDefault"),
    state: t("autoobserve.policy.alwaysOn"),
    variant: "success-soft" as BadgeVariant,
  },
  ...CHANNELS.map((d) => ({
    key: d.id,
    label:
      d.kind === "slack"
        ? t("autoobserve.policy.channelSlack", { channel: raw(d.name) })
        : t("autoobserve.policy.channelEmail", { address: raw(d.name) }),
    description: t("autoobserve.policy.channelConnectedDesc"),
    state: t("autoobserve.policy.connected"),
    variant: "blue-soft" as BadgeVariant,
  })),
]);

const isSection = (value: unknown): value is Section => SECTIONS.includes(value as Section);
// Tab names are prefixed so their element ids don't collide with the page-level "coverage" tab.
const tabName = (key: Section) => `policy-${key}`;
const section = ref<Section>(isSection(route.query.policy) ? route.query.policy : "coverage");

const select = (name: string | number) => {
  const key = String(name).replace("policy-", "");
  if (!isSection(key)) return;
  section.value = key;
  void router.replace({
    query: { ...route.query, policy: key === "coverage" ? undefined : key },
  });
};

const classesIn = (key: Section) => groups.value.find((g) => g.section === key)?.classes ?? [];

const tabsRoot = ref<HTMLElement | null>(null);
// Reka replaces OTab's id and aria-controls with its own, so the tab-panel pairing is restored here.
onMounted(() => {
  tabsRoot.value?.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
    const panel = document.getElementById(`tab-panel-${tab.dataset.otabName}`);
    if (!panel) return;
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("aria-labelledby", tab.id);
  });
});

const modeSummary = (cls: { mode: PolicyMode }[]) =>
  MODE_ORDER.map((mode) => ({ mode, count: cls.filter((c) => c.mode === mode).length }))
    .filter((m) => m.count > 0)
    .map((m) =>
      t("autoobserve.policy.summary.count", { count: m.count, mode: t(MODE_LABEL[m.mode]) }),
    )
    .join(" · ");

const tabs = computed(() => {
  const summary: Record<Section, string> = {
    coverage: modeSummary(classesIn("coverage")),
    alerts: modeSummary(classesIn("alerts")),
    fixes: modeSummary(classesIn("fixes")),
    investigation: triageRows.value
      .map((row) => t("autoobserve.policy.summary.row", { label: row.short, mode: row.mode }))
      .join(" · "),
    channels: t("autoobserve.policy.summary.channels", { count: CHANNELS.length }),
  };
  return SECTIONS.map((key) => ({ key, label: t(SECTION_LABEL[key]), summary: raw(summary[key]) }));
});
</script>
