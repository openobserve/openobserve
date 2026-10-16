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

      <div v-if="actions.length" class="flex flex-wrap items-center gap-1.5">
        <OText variant="label" as="span" class="me-1">{{
          t("alertCalibration.detail.proposedActions")
        }}</OText>
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
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { FindingRecord } from "./digests";
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

const openAlert = () =>
  router.push({
    name: "alertDetail",
    params: { alert_id: props.finding.alert_id },
    query: { org_identifier: orgId.value },
  });

const evidence = computed(() =>
  meta.value.evidence.map((field) => ({
    column: field.column,
    label: t(field.labelKey),
    value: formatEvidence(t, props.finding[field.column], field.format),
    // Free text runs long, so it takes its own line instead of squeezing the numbers beside it.
    wide: field.format === "text",
  })),
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
            description: t(ACTION_META[name].descriptionKey),
          }
        : { name, label: raw(name) },
    ),
);
</script>
