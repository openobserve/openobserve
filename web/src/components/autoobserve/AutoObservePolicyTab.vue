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
          :description="t(CLASS_DESC[cls.id])"
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

      <OFormSection :title="t('autoobserve.policy.budgets')" data-test="autoobserve-policy-budgets">
        <p class="text-text-secondary py-1 text-xs">{{ t("autoobserve.policy.budgetsHint") }}</p>
        <OSettingRow
          v-for="b in BUDGETS"
          :key="b.id"
          :label="b.destination"
          :description="t(KIND_LABEL[b.kind])"
          :data-test="`autoobserve-policy-budget-${b.id}`"
        >
          <span class="text-text-body text-sm">{{
            b.digest
              ? t("autoobserve.policy.budgetValueDigest", { limit: b.limit })
              : t("autoobserve.policy.budgetValue", { limit: b.limit })
          }}</span>
        </OSettingRow>
        <p class="text-text-secondary flex items-center gap-1 py-2 text-xs">
          <OIcon name="info-outline" size="xs" />{{ t("autoobserve.policy.budgetsP1") }}
        </p>
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
import { ACTION_CLASSES, BUDGETS, type Budget, type PolicyMode } from "./fixtures";

const { t } = useI18nTyped();

const CLASS_DESC: Record<string, I18nKey> = {
  RepairDestination: "autoobserve.policy.classes.RepairDestination",
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
const KIND_LABEL: Record<Budget["kind"], I18nKey> = {
  slack: "autoobserve.policy.kindSlack",
  pagerduty: "autoobserve.policy.kindPagerDuty",
  email: "autoobserve.policy.kindEmail",
};

const groups = computed(() => [
  {
    key: "coverage",
    title: t("autoobserve.policy.groupCoverage"),
    hint: t("autoobserve.policy.groupCoverageHint"),
    classes: ACTION_CLASSES.filter((c) => c.group === "coverage"),
  },
  {
    key: "calibration",
    title: t("autoobserve.policy.groupCalibration"),
    hint: t("autoobserve.policy.gateHint"),
    classes: ACTION_CLASSES.filter((c) => c.group === "calibration"),
  },
  {
    key: "action",
    title: t("autoobserve.policy.phase2Title"),
    hint: t("autoobserve.policy.phase2Hint"),
    classes: ACTION_CLASSES.filter((c) => c.group === "action"),
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
  {
    key: "slack-oncall-payments",
    label: t("autoobserve.policy.channelSlack", { channel: raw("#oncall-payments") }),
    description: t("autoobserve.policy.channelConnectedDesc"),
    state: t("autoobserve.policy.connected"),
    variant: "blue-soft" as BadgeVariant,
  },
  {
    key: "pagerduty-payments",
    label: t("autoobserve.policy.channelPagerDuty", { service: raw("payments") }),
    description: t("autoobserve.policy.channelConnectedDesc"),
    state: t("autoobserve.policy.connected"),
    variant: "blue-soft" as BadgeVariant,
  },
]);
</script>
