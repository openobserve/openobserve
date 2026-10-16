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
  <OCard :data-test="`alert-calibration-finding-${finding.rule_id}`">
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <OIcon :name="meta.icon" size="md" class="text-text-secondary mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <OText variant="body-strong" as="div">{{ finding.title }}</OText>
          <div class="flex flex-wrap items-center gap-1.5">
            <OBadge :variant="SEVERITY_BADGE[finding.severity]" size="xs" shape="rounded">
              {{ t(SEVERITY_LABEL[finding.severity]) }}
            </OBadge>
            <OBadge variant="default-soft" size="xs" shape="rounded">
              {{ t(CONFIDENCE_LABEL[finding.confidence]) }}
            </OBadge>
            <OBadge variant="default-outline" size="xs" shape="rounded">{{
              t(meta.labelKey)
            }}</OBadge>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <OText variant="label" as="div">{{ t("alertCalibration.detail.evidence") }}</OText>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <div
            v-for="row in evidence"
            :key="row.column"
            class="flex min-w-0 items-baseline justify-between gap-3"
          >
            <dt class="text-text-secondary shrink-0 text-xs">{{ row.label }}</dt>
            <OTruncatedText as="dd" class="text-text-body min-w-0 text-xs font-medium tabular-nums">
              {{ row.value }}
            </OTruncatedText>
          </div>
        </dl>
      </div>

      <div v-if="finding.alert_name" class="flex flex-col gap-1.5">
        <OText variant="label" as="div">{{ t("alertCalibration.detail.alert") }}</OText>
        <div>
          <OTag
            icon="notifications"
            variant="default-soft"
            size="sm"
            :label="raw(finding.alert_name)"
          />
        </div>
      </div>

      <div
        v-for="list in lagLists"
        :key="list.column"
        class="flex flex-col gap-1.5"
        :data-test="`alert-calibration-finding-${list.key}-list`"
      >
        <OText variant="label" as="div">{{ list.label }}</OText>
        <ul class="flex flex-col gap-1">
          <li
            v-for="row in list.rows"
            :key="row.key"
            class="flex min-w-0 items-baseline justify-between gap-3"
            data-test="alert-calibration-finding-lag-row"
          >
            <OTruncatedText class="text-text-body min-w-0 text-xs font-medium">
              {{ row.label }}
            </OTruncatedText>
            <span class="text-text-secondary shrink-0 text-xs tabular-nums">
              {{
                t("alertCalibration.detail.lagImpact", {
                  skipped: formatEvidence(t, row.skipped_windows, "count"),
                  late: formatEvidence(t, row.late_evaluations, "count"),
                  evaluations: formatEvidence(t, row.evaluations, "count"),
                })
              }}
            </span>
          </li>
        </ul>
      </div>

      <div v-if="actions.length" class="flex flex-col gap-1.5">
        <OText variant="label" as="div">{{ t("alertCalibration.detail.proposedActions") }}</OText>
        <div class="flex flex-wrap gap-1.5">
          <OTag
            v-for="action in actions"
            :key="action.name"
            icon="lightbulb-outline"
            variant="default-outline"
            size="sm"
            :label="action.label"
            :title="action.description"
          />
        </div>
      </div>
    </div>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { format } from "date-fns";
import OCard from "@/lib/core/Card/OCard.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { parseLagRows, type FindingRecord } from "./digests";
import { ACTION_META, isProposedAction, RULE_META } from "./rules";
import { CONFIDENCE_LABEL, formatEvidence, SEVERITY_BADGE, SEVERITY_LABEL } from "./format";

const props = defineProps<{ finding: FindingRecord }>();

const { t } = useI18nTyped();

const meta = computed(() => RULE_META[props.finding.rule_id]);

const evidence = computed(() =>
  meta.value.evidence.map((field) => ({
    column: field.column,
    label: t(field.labelKey),
    value: formatEvidence(t, props.finding[field.column], field.format),
  })),
);

/** Only lists that name something show, each row labelled by its org or its hour. */
const lagLists = computed(() =>
  (meta.value.lagLists ?? [])
    .map((list) => ({
      column: list.column,
      key: list.key,
      label: t(list.labelKey),
      rows: parseLagRows(props.finding[list.column], list.key).map((row) => ({
        ...row,
        label:
          list.key === "org_id"
            ? raw(String(row.key))
            : raw(format(Number(row.key) / 1000, "MMM d, HH:mm")),
      })),
    }))
    .filter((list) => list.rows.length > 0),
);

/** `actions` is comma-joined; an action this build does not know still shows, by its raw name. */
const actions = computed<{ name: string; label: I18nText; description?: I18nText }[]>(() =>
  (props.finding.actions ?? "")
    .split(",")
    .filter(Boolean)
    .map((name) =>
      isProposedAction(name)
        ? {
            name,
            label: t(ACTION_META[name].labelKey),
            description: t(
              ACTION_META[name].descriptionKey,
              ACTION_META[name].descriptionParams ?? {},
            ),
          }
        : { name, label: raw(name) },
    ),
);
</script>
