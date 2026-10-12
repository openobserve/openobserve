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

      <OFormSection
        v-for="group in groups"
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
          <OTag :variant="MODE_VARIANT[cls.mode]" size="sm" :label="t(MODE_LABEL[cls.mode])" />
        </OSettingRow>
      </OFormSection>

      <OFormSection
        :title="t('autoobserve.policy.investigation')"
        data-test="autoobserve-policy-triage"
      >
        <p class="text-text-secondary py-1 text-xs">{{ t("autoobserve.policy.triageHint") }}</p>
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

      <OFormSection :title="t('autoobserve.policy.paging')" data-test="autoobserve-policy-paging">
        <p class="text-text-secondary py-1 text-xs">{{ t("autoobserve.policy.pagingHint") }}</p>
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

      <OFormSection
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

      <OCard variant="outlined" data-test="autoobserve-policy-outcomes">
        <OCardSection role="header">
          <OIcon name="trending-up" size="sm" class="text-text-secondary" />
          <OText variant="panel-title">{{ t("autoobserve.policy.outcomesTitle") }}</OText>
          <OTag class="ms-auto" variant="purple-soft" size="xs" :label="t('autoobserve.phase2')" />
        </OCardSection>
        <OCardSection role="body" class="flex flex-col gap-2 pt-0">
          <p class="text-text-body text-sm">{{ t("autoobserve.policy.outcomesBody") }}</p>
          <p class="text-text-secondary text-xs">{{ t("autoobserve.policy.outcomesExample") }}</p>
        </OCardSection>
      </OCard>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { CHANNELS, actionClassesFor, type PolicyMode } from "./fixtures";
import { useAutonomy, useCompletedFixes } from "./v2/useDecisions";
import { recordFor, say } from "./v2/fixtures";
import { AUTONOMY } from "./data/facts";

const { t } = useI18nTyped();

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
    title: t("autoobserve.policy.groupCoverage"),
    hint: t("autoobserve.policy.groupCoverageHint"),
    classes: classes.value.filter((c) => c.group === "coverage"),
  },
  {
    key: "calibration",
    title: t("autoobserve.policy.groupCalibration"),
    hint: t("autoobserve.policy.gateHint"),
    classes: classes.value.filter((c) => c.group === "calibration"),
  },
  {
    key: "action",
    title: t("autoobserve.policy.phase2Title"),
    hint: t("autoobserve.policy.phase2Hint"),
    classes: classes.value.filter((c) => c.group === "action"),
  },
]);

const triageRows = computed(() => [
  {
    key: "p1",
    label: t("alerts.incidents.severityP1"),
    description: t("autoobserve.policy.triage.p1Desc"),
    mode: t("autoobserve.policy.triage.parallel"),
    variant: "default-soft" as BadgeVariant,
  },
  {
    key: "p2-p4",
    label: t("autoobserve.policy.triage.p2p4"),
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
</script>
