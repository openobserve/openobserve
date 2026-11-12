<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <OCard v-if="view" class="mt-4" data-test="alert-calibration-headroom-card">
    <OCardSection role="body">
      <h3 class="text-text-heading mb-3 text-lg">{{ t("alertCalibration.headroom.title") }}</h3>
      <div class="flex items-start gap-2">
        <OIcon name="info" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
        <div class="text-text-body flex min-w-0 flex-col gap-1 text-sm">
          <p data-test="alert-calibration-headroom-sentence">{{ view.sentence }}</p>
          <p v-if="view.edited" data-test="alert-calibration-headroom-edited">
            {{ view.edited }}
          </p>
          <OText variant="meta" as="p" data-test="alert-calibration-headroom-source">
            {{ view.source }}
          </OText>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOrgId } from "@/composables/query";
import { useAlertCalibrationEnabled } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import { useI18nTyped } from "@/types/i18n";
import { alertHeadroomQuery } from "@/services/alert_calibration.queries";
import { formatEvidence } from "./format";
import { headroomEditedLine, headroomSentence } from "./headroom";

const props = defineProps<{ alertId: string }>();

const DAY_MICROS = 86_400_000_000;

const { t } = useI18nTyped();
const orgId = useOrgId();
const calibrationEnabled = useAlertCalibrationEnabled();

const headroomQuery = useQuery(() => ({
  ...alertHeadroomQuery(orgId.value, props.alertId),
  enabled: calibrationEnabled.value && !!orgId.value && !!props.alertId,
}));

// Renders only with data, so a load, a gap or an error never shows a placeholder that empties.
const view = computed(() => {
  if (!calibrationEnabled.value) return null; // `enabled` stops fetching but keeps cached data
  const found = headroomQuery.data.value;
  if (!found) return null;
  const sentence = headroomSentence(t, found.headroom, {
    form: "long",
    days: (found.runWindow.end - found.runWindow.start) / DAY_MICROS,
    sentinel: found.skip.skip_reason === "sentinel_by_design",
  });
  if (!sentence) return null;
  return {
    sentence,
    edited: headroomEditedLine(t, found.headroom),
    source: t("alertCalibration.headroom.source", {
      date: formatEvidence(t, found.emittedAt, "time"),
    }),
  };
});
</script>
