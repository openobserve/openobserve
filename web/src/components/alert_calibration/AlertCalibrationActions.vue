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
  <OButton
    v-if="part === 'configure'"
    variant="outline"
    size="sm"
    icon-left="settings"
    data-test="alert-calibration-configure"
    @click="configure"
  >
    {{ t("alertCalibration.configure") }}
  </OButton>
  <OButton
    v-else
    variant="primary"
    size="sm"
    icon-left="play-arrow"
    :loading="pending"
    :disabled="!config?.enabled"
    data-test="alert-calibration-run-now"
    @click="runNow"
  >
    {{ t("alertCalibration.runNow") }}
    <OTooltip
      side="bottom"
      :content="
        config?.enabled ? t('alertCalibration.runNowHint') : t('alertCalibration.runNeedsConfig')
      "
    />
  </OButton>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import type { AlertCalibrationConfig } from "@/services/alert_calibration";
import { useRequestAlertCalibrationRun } from "@/composables/alertCalibration/useRequestAlertCalibrationRun";

/** `run` is the header's primary action; `configure` goes in its overflow, so a phone folds it away. */
defineProps<{ config: AlertCalibrationConfig | null; part: "run" | "configure" }>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const { pending, runNow } = useRequestAlertCalibrationRun();

const configure = () =>
  router.push({ name: "alertCalibrationSettings", query: { org_identifier: orgId.value } });
</script>
