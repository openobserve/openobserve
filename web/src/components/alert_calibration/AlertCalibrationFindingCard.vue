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
  <OCard variant="glass" :data-test="`alert-calibration-finding-${finding.rule_id}`">
    <OCardSection role="header" class="items-start gap-3 py-3">
      <span
        class="rounded-default inline-flex size-7 shrink-0 items-center justify-center"
        :class="SEVERITY_TILE[finding.severity]"
        data-test="alert-calibration-finding-tile"
      >
        <OIcon :name="meta.icon" size="sm" />
      </span>
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
      <OButton
        v-if="finding.alert_id"
        variant="ghost-muted"
        size="xs"
        icon-left="open-in-new"
        class="shrink-0"
        data-test="alert-calibration-finding-open-alert"
        @click="openAlert"
      >
        {{ t("alertCalibration.detail.openAlert") }}
      </OButton>
    </OCardSection>

    <OSeparator />

    <OCardSection role="body" class="flex flex-col gap-2 pt-3">
      <dl class="flex flex-wrap gap-x-6 gap-y-1">
        <div
          v-for="row in evidence"
          :key="row.column"
          class="flex min-w-0 items-baseline gap-1.5"
          :class="row.wide ? 'basis-full' : ''"
        >
          <dt class="text-text-secondary shrink-0 text-xs">{{ row.label }}</dt>
          <OTruncatedText as="dd" class="text-text-body min-w-0 text-xs font-medium tabular-nums">
            {{ row.value }}
          </OTruncatedText>
        </div>
      </dl>

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

      <div
        v-if="actions.length"
        class="rounded-default bg-surface-subtle border-s-border-strong flex flex-col gap-1 border-s-4 px-3 py-2"
        data-test="alert-calibration-finding-actions"
      >
        <OText variant="label" as="div">{{ t("alertCalibration.detail.proposedActions") }}</OText>
        <div
          v-for="action in actions"
          :key="action.name"
          class="flex min-w-0 flex-wrap items-baseline gap-x-2"
        >
          <span class="text-text-body text-xs font-medium">{{ action.label }}</span>
          <OText v-if="action.description" variant="meta" as="span">{{ action.description }}</OText>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { format } from "date-fns";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { parseLagRows, type FindingRecord } from "./digests";
import { ACTION_META, isProposedAction, RULE_META } from "./rules";
import {
  CONFIDENCE_LABEL,
  formatEvidence,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  SEVERITY_TILE,
} from "./format";

const props = defineProps<{ finding: FindingRecord }>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const meta = computed(() => RULE_META[props.finding.rule_id]);

/** A new tab, so the digest stays where it was while the alert is fixed. */
const openAlert = () => {
  const { href } = router.resolve({
    name: "alertDetail",
    params: { alert_id: props.finding.alert_id },
    query: { org_identifier: orgId.value },
  });
  window.open(href, "_blank", "noopener,noreferrer");
};

const evidence = computed(() =>
  meta.value.evidence.map((field) => ({
    column: field.column,
    label: t(field.labelKey),
    value: formatEvidence(t, props.finding[field.column], field.format),
    // Free text runs long, so it takes its own line instead of squeezing the numbers beside it.
    wide: field.format === "text",
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
