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
  <template v-if="noAccess" />
  <OButton
    v-else-if="part === 'configure'"
    variant="outline"
    size="sm"
    icon-left="settings"
    data-test="alert-calibration-configure"
    @click="configure"
  >
    {{ t("alertCalibration.configure") }}
  </OButton>
  <OButton
    v-else-if="canRun"
    variant="primary"
    size="sm"
    icon-left="play-arrow"
    :loading="pending"
    :disabled="!config?.enabled || denied"
    data-test="alert-calibration-run-now"
    @click="runNow"
  >
    {{ t("alertCalibration.runNow") }}
    <OTooltip side="bottom" :content="hint" />
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import { httpStatus, type AlertCalibrationConfig } from "@/services/alert_calibration";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import {
  useAlertCalibrationRights,
  useRequestAlertCalibrationRun,
} from "@/composables/alertCalibration/useRequestAlertCalibrationRun";

/** `run` is the header's primary action; `configure` goes in its overflow, so a phone folds it away. */
const props = defineProps<{ config: AlertCalibrationConfig | null; part: "run" | "configure" }>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const { pending, denied, runNow } = useRequestAlertCalibrationRun();
const { canRun } = useAlertCalibrationRights();
// The page reads the same config; a 403 on it means this reader can neither run nor configure.
const configRead = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const noAccess = computed(() => httpStatus(configRead.error.value) === 403);

const hint = computed(() => {
  if (denied.value) return t("alertCalibration.runDenied");
  return props.config?.enabled
    ? t("alertCalibration.runNowHint")
    : t("alertCalibration.runNeedsConfig");
});

const configure = () =>
  router.push({ name: "alertCalibrationSettings", query: { org_identifier: orgId.value } });
</script>
