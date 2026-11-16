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
  <OverviewSectionCard
    section="firing-now"
    :title="t('overview.firingNow.title')"
    :subtitle="subtitle"
    :link-label="state === 'ok' && rows.length > 0 ? t('overview.viewAll') : undefined"
    view="ok"
    @view-all="router.push(firingListRoute)"
  >
    <!-- every state keeps the four-row height, so the band never moves the page -->
    <div class="flex flex-col lg:min-h-37" :data-test="`overview-firing-now-${state}`">
      <ul v-if="state === 'loading'" class="divide-border-subtle flex flex-col divide-y">
        <li v-for="i in ROWS" :key="i" class="flex h-9 items-center gap-3">
          <OSkeleton shape="block" class="h-4 w-16 shrink-0" />
          <OSkeleton shape="block" class="h-4 w-40" />
          <OSkeleton shape="block" class="ms-auto h-3 w-12 shrink-0" />
        </li>
      </ul>
      <OEmptyState
        v-else-if="state === 'error' || state === 'unavailable'"
        size="compact"
        kind="error"
        :title="
          state === 'error'
            ? t('overview.firingNow.loadError')
            : t('overview.firingNow.unavailable')
        "
      >
        <template #actions>
          <OButton size="sm" data-test="overview-firing-now-retry" @click="emit('retry')">
            {{ t("emptyState.loadError.action") }}
          </OButton>
        </template>
      </OEmptyState>
      <OEmptyState
        v-else-if="state === 'denied'"
        size="compact"
        kind="denied"
        :title="t('emptyState.noAccess.title')"
        :text="t('overview.state.sectionForbidden')"
      />
      <OEmptyState
        v-else-if="state === 'locked'"
        size="compact"
        icon="lock"
        :title="lockedReason ?? t('overview.state.sectionLocked')"
      />
      <OEmptyState
        v-else-if="totalRules === 0"
        size="compact"
        icon="notifications"
        :title="t('overview.firingNow.noRules')"
      >
        <template #actions>
          <OButton size="sm" :to="libraryRoute" data-test="overview-firing-now-library">
            {{ t("overview.firingNow.browseLibrary") }}
          </OButton>
        </template>
      </OEmptyState>
      <div
        v-else-if="rows.length === 0"
        class="flex min-h-9 flex-wrap items-center gap-x-2"
        data-test="overview-firing-now-quiet"
      >
        <OIcon name="check-circle" size="sm" class="text-status-success-text shrink-0" />
        <p class="text-text-heading text-compact font-medium">
          {{ t("overview.firingNow.allQuiet") }}
        </p>
        <p class="text-text-secondary text-xs">
          {{ t("overview.firingNow.watching", { count: enabledRules }, enabledRules) }}
        </p>
      </div>
      <template v-else>
        <ul
          class="divide-border-subtle flex flex-col divide-y"
          data-test="overview-firing-now-rows"
        >
          <li v-for="row in shown" :key="row.alert_id" class="py-0.5">
            <div class="-mx-3 flex items-center">
              <OverviewRowButton
                class="min-w-0 flex-1"
                :to="detailRoute(row)"
                :data-test="`overview-firing-now-row-${row.name}`"
              >
                <span class="flex min-w-0 items-center gap-3">
                  <OTag
                    type="countChip"
                    :value="LEVEL_TONE[firingLevel(row)]"
                    class="min-w-16 shrink-0 justify-center"
                    :data-test="`overview-firing-now-level-${row.name}`"
                    >{{ levelLabel(row) }}</OTag
                  >
                  <OTruncatedText class="text-text-body text-compact min-w-0 shrink font-medium">{{
                    raw(row.name)
                  }}</OTruncatedText>
                  <OTruncatedText
                    v-if="row.stream_name"
                    class="text-text-secondary min-w-0 text-xs font-normal max-sm:hidden"
                    >{{ raw(row.stream_name) }}</OTruncatedText
                  >
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <OTag
                    v-if="row.last_outcome === 'notify_failed'"
                    tone="warn"
                    icon="sync-problem"
                    size="sm"
                    :label="t('alerts.summaryDeliveryFailed')"
                    :data-test="`overview-firing-now-undelivered-${row.name}`"
                  />
                  <span
                    v-if="row.firing_started_at"
                    class="text-text-secondary text-xs font-normal tabular-nums"
                    >{{ raw(firingForLabel(row.firing_started_at, now)) }}</span
                  >
                </span>
              </OverviewRowButton>
              <span v-if="askVisible" class="flex w-9 shrink-0 justify-center">
                <OverviewAskAiButton
                  kind="alert"
                  :item-key="row.name"
                  :label="row.name"
                  @ask="emit('askAi', { kind: 'alert', alert: askAlert(row) })"
                />
              </span>
            </div>
          </li>
        </ul>
        <div v-if="hidden > 0" class="flex h-9 items-center">
          <OButton
            variant="accent-ghost"
            size="sm"
            class="-ms-2.5"
            :to="firingListRoute"
            data-test="overview-firing-now-more"
          >
            {{ t("overview.alerts.showMore", { count: hidden }, hidden) }}
          </OButton>
        </div>
      </template>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { firingForLabel } from "@/utils/alerts/firingAlerts";
import OverviewAskAiButton from "./OverviewAskAiButton.vue";
import OverviewRowButton from "./OverviewRowButton.vue";
import type { OverviewAskAiTarget } from "./overviewAskAi";
import { useOverviewAskAi } from "./useOverviewAskAi";
import type { OverviewFiringAlert } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { firingByLevel, firingLevel, type FiringLevel, type HomeAlertRow } from "./overviewFiring";

export type FiringNowState = "loading" | "error" | "unavailable" | "denied" | "locked" | "ok";

const ROWS = 4;

const LEVEL_TONE: Record<FiringLevel, string> = {
  critical: "error",
  warning: "warning",
  other: "neutral",
};

const props = defineProps<{
  state: FiringNowState;
  /** Firing now, most severe first. */
  rows: HomeAlertRow[];
  enabledRules: number;
  totalRules: number;
  lockedReason?: I18nText;
  /** The clock the firing ages are read against, in milliseconds. */
  now: number;
}>();

const emit = defineEmits<{ retry: []; askAi: [target: OverviewAskAiTarget] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const { visible: askVisible } = useOverviewAskAi();

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

// the assistant reads the same alert shape the summary endpoint sends
const askAlert = (row: HomeAlertRow): OverviewFiringAlert => {
  const level = firingLevel(row);
  return {
    name: row.name,
    stream: row.stream_name ?? "",
    level: level === "other" ? "unclassified" : level,
    since: row.firing_started_at ?? 0,
  };
};

// a list longer than the band gives its last row to the "more" link
const shown = computed(() =>
  props.rows.length > ROWS ? props.rows.slice(0, ROWS - 1) : props.rows,
);
const hidden = computed(() => props.rows.length - shown.value.length);

const subtitle = computed<I18nText | undefined>(() => {
  if (props.state !== "ok" || props.rows.length === 0) return undefined;
  const counts = firingByLevel(props.rows);
  return t("overview.firingNow.byLevel", { critical: counts.critical, warning: counts.warning });
});

const levelLabel = (row: HomeAlertRow): I18nText => {
  const level = firingLevel(row);
  if (level === "critical") return t("overview.level.critical");
  return level === "warning" ? t("overview.level.warning") : t("overview.level.okFiring");
};

const detailRoute = (row: HomeAlertRow) => ({
  name: "alertDetail",
  params: { alert_id: row.alert_id },
  query: { org_identifier: org.value, folder: row.folder_id || "default" },
});

const firingListRoute = computed(() => ({
  name: "alertFiring",
  query: { org_identifier: org.value },
}));

const libraryRoute = computed(() => ({
  name: "alertLibrary",
  query: { org_identifier: org.value },
}));
</script>
