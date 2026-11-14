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
  <OPageLayout
    :title="t('alertCalibration.settings.title')"
    :about="t('alertCalibration.subtitle')"
    :back="{ label: t('alertCalibration.title'), to: dashboardRoute }"
    data-test="alert-calibration-settings"
  >
    <div class="flex flex-col gap-4">
      <div v-if="configQuery.isPending.value" class="flex flex-col gap-3">
        <OSkeleton shape="block" class="h-14 w-full" />
        <OSkeleton shape="block" class="h-14 w-full" />
      </div>

      <OInlineNotice
        v-else-if="configQuery.isError.value"
        tone="err"
        data-test="alert-calibration-settings-load-error"
      >
        {{ readErrorCopy(t, configQuery.error.value, "settings") }}
        <template #actions>
          <OButton variant="secondary" @click="reload">{{ t("alertCalibration.retry") }}</OButton>
        </template>
      </OInlineNotice>

      <template v-else>
        <OInlineNotice v-if="!config" tone="info" data-test="alert-calibration-settings-no-config">
          {{ t("alertCalibration.settings.noConfig") }}
        </OInlineNotice>

        <AlertCalibrationSettingsForm
          :key="config?.updated_at ?? 'defaults'"
          :config="config"
          :read-only="!canEdit"
        />

        <OFormSection :title="t('alertCalibration.settings.runNowHeading')">
          <div class="flex flex-col gap-3">
            <OText v-if="canRun" variant="body" as="p">{{
              t("alertCalibration.runNowHint")
            }}</OText>
            <p
              v-else
              class="text-text-secondary flex items-start gap-1.5 text-xs"
              data-test="alert-calibration-settings-run-denied"
            >
              <OIcon name="lock" size="xs" class="mt-0.5 shrink-0" />
              <span>{{ t("alertCalibration.runDenied") }}</span>
            </p>
            <div v-if="canRun" class="flex flex-wrap items-center gap-3">
              <OButton
                variant="secondary"
                icon="play-arrow"
                :loading="pending"
                :disabled="!config?.enabled"
                data-test="alert-calibration-settings-run"
                @click="runNow"
              >
                {{ t("alertCalibration.runNow") }}
              </OButton>
              <OText v-if="!config?.enabled" variant="meta" as="span">
                {{ t("alertCalibration.runNeedsConfig") }}
              </OText>
            </div>
            <AlertCalibrationLastRun v-if="config" />
            <blockquote
              class="rounded-default bg-surface-subtle border-s-border-strong border-s-4 px-3 py-2"
            >
              <OText variant="meta" as="p">
                {{ t("alertCalibration.settings.findingsKept") }}
              </OText>
            </blockquote>
          </div>
        </OFormSection>
      </template>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import { readErrorCopy } from "@/services/alert_calibration";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import {
  useAlertCalibrationRights,
  useRequestAlertCalibrationRun,
} from "@/composables/alertCalibration/useRequestAlertCalibrationRun";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import AlertCalibrationSettingsForm from "./AlertCalibrationSettingsForm.vue";

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const orgId = useOrgId();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);
const { pending, runNow } = useRequestAlertCalibrationRun();
const { canRun, canEdit } = useAlertCalibrationRights();

const reload = () => void configQuery.refetch();

const dashboardRoute = computed(() => ({
  name: "alertCalibration",
  query: { org_identifier: orgId.value },
}));
</script>
