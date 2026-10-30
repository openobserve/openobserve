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
  <OBanner
    v-if="lastRun?.status === 'error'"
    variant="warning"
    data-test="alert-calibration-last-run-failed"
  >
    {{
      t("alertCalibration.lastRun.failed", {
        time: formatAgo(lastRun.finished_at),
        error: raw(lastRun.error ?? ""),
      })
    }}
  </OBanner>
  <OText v-else-if="!onlyFailure" variant="meta" as="p" data-test="alert-calibration-last-run">
    {{
      lastRun
        ? t("alertCalibration.lastRun.succeeded", { time: formatAgo(lastRun.finished_at) })
        : t("alertCalibration.lastRun.none")
    }}
  </OText>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { formatDistanceToNowStrict } from "date-fns";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped } from "@/types/i18n";
import { alertCalibrationStatusQuery } from "@/services/alert_calibration.queries";

/** `onlyFailure` keeps a page quiet unless the newest digest is stale because a run failed. */
defineProps<{ onlyFailure?: boolean }>();

const { t } = useI18nTyped();
const orgId = useOrgId();

const statusQuery = useQuery(() => alertCalibrationStatusQuery(orgId.value));
const lastRun = computed(() => statusQuery.data.value?.last_run ?? null);

const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));
</script>
