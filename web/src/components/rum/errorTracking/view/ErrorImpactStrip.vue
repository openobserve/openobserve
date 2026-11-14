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
  <section :aria-label="t('rum.errorDetail.impactAria')" data-test="rum-error-impact-strip">
    <OStatStrip :items="items" :loading="loading" />
    <small v-if="scopeCaption" class="mt-1 block" data-test="rum-error-impact-strip-scope">{{
      scopeCaption
    }}</small>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem, StatValue } from "@/lib/data/StatStrip/OStatStrip.types";
import { formatLargeNumber } from "@/utils/formatters";
import { formatCompactAge, formatRelativeTime } from "@/utils/rum/errorIssueUtils";
import type { ErrorImpact } from "@/composables/rum/useErrorDetail";

// hasSignature defaults to TRUE explicitly: Vue casts an absent boolean prop to
// false, which would otherwise make every caller that omits it claim the error
// cannot be grouped.
const props = withDefaults(
  defineProps<{
    impact: ErrorImpact | null;
    loading?: boolean;
    /** False when the error has no signature strong enough to aggregate on. */
    hasSignature?: boolean;
  }>(),
  { hasSignature: true },
);

const { t } = useI18nTyped();

// Unknown rather than zero while loading or unavailable: "0 users affected" is a claim.
const count = (value: number | null | undefined): StatValue =>
  props.loading || value == null ? null : formatLargeNumber(value);

const age = (value: number | undefined): StatValue =>
  props.loading || !value ? null : formatCompactAge(value);

const items = computed<StatItem[]>(() => {
  const impact = props.impact;
  return [
    {
      key: "events",
      label: t("rum.errorDetail.occurrences"),
      value: count(impact?.events),
      icon: "error",
      tone: "err",
      dataTest: "rum-error-impact-events",
    },
    {
      key: "users",
      label: t("rum.usersAffected"),
      value: count(impact?.usersAffected),
      icon: "group",
      tone: "warn",
      dataTest: "rum-error-impact-users",
    },
    {
      key: "sessions",
      label: t("rum.errorDetail.sessionsAffected"),
      value: count(impact?.sessionsAffected),
      icon: "devices",
      tone: "info",
      dataTest: "rum-error-impact-sessions",
    },
    {
      key: "first-seen",
      label: t("rum.errorDetail.firstSeen"),
      value: age(impact?.firstSeen),
      icon: "history",
      dataTest: "rum-error-impact-first-seen",
    },
    {
      key: "last-seen",
      label: t("rum.errorDetail.lastSeen"),
      value: age(impact?.lastSeen),
      icon: "schedule",
      dataTest: "rum-error-impact-last-seen",
    },
  ];
});

const scopeCaption = computed(() => {
  if (props.hasSignature === false) return t("rum.errorDetail.noSignature");
  if (props.loading || !props.impact?.firstSeen) return "";
  return t("rum.errorDetail.impactScope", {
    firstSeen: formatRelativeTime(props.impact.firstSeen),
    lastSeen: formatRelativeTime(props.impact.lastSeen),
  });
});
</script>
