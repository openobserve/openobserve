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
    :subtitle="t('alertCalibration.subtitle')"
    icon="tune"
    :back="{ label: t('alertCalibration.title'), onClick: openPage }"
    data-test="alert-calibration-settings"
  >
    <div class="flex flex-col gap-4">
      <div v-if="configQuery.isPending.value" class="flex flex-col gap-3">
        <OSkeleton class="rounded-default h-14 w-full" />
        <OSkeleton class="rounded-default h-14 w-full" />
      </div>

      <OBanner
        v-else-if="configQuery.isError.value"
        variant="error"
        data-test="alert-calibration-settings-load-error"
      >
        {{
          t("alertCalibration.settings.loadFailed", {
            message: loadErrorMessage(configQuery.error.value),
          })
        }}
        <template #actions>
          <OButton variant="outline" size="sm" @click="reload">{{
            t("alertCalibration.retry")
          }}</OButton>
        </template>
      </OBanner>

      <template v-else>
        <OBanner v-if="!config" variant="info" data-test="alert-calibration-settings-no-config">
          {{ t("alertCalibration.settings.noConfig") }}
        </OBanner>

        <AlertCalibrationSettingsForm :key="config?.updated_at ?? 'defaults'" :config="config" />

        <OFormSection :title="t('alertCalibration.settings.runNowHeading')">
          <div class="flex flex-col gap-3">
            <OText variant="body" as="p">{{ t("alertCalibration.runNowHint") }}</OText>
            <AlertCalibrationLastRun v-if="config" />
            <div class="flex flex-wrap items-center gap-3">
              <OButton
                variant="outline"
                size="sm-action"
                icon-left="play-arrow"
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
            <OText variant="meta" as="p">
              {{ t("alertCalibration.settings.findingsDesc", { stream: DIGEST_STREAM }) }}
            </OText>
          </div>
        </OFormSection>
      </template>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped } from "@/types/i18n";
import { errorMessage } from "@/services/alert_calibration";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import { useRequestAlertCalibrationRun } from "@/composables/alertCalibration/useRequestAlertCalibrationRun";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import { DIGEST_STREAM } from "./digests";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import AlertCalibrationSettingsForm from "./AlertCalibrationSettingsForm.vue";

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const orgId = useOrgId();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);
const { pending, runNow } = useRequestAlertCalibrationRun();

const loadErrorMessage = (error: unknown) => raw(errorMessage(error));

const reload = () => void configQuery.refetch();

const openPage = () =>
  router.push({ name: "alertCalibration", query: { org_identifier: orgId.value } });
</script>
