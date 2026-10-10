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
    v-if="variant === 'banner'"
    variant="warning"
    icon="warning"
    data-test="logs-auto-run-guard-banner"
    class="mx-2.5 mt-2"
  >
    <span data-test="logs-auto-run-guard-estimate">{{ bannerText }}</span>
    <template #actions>
      <OButton
        v-if="showRun"
        variant="primary"
        size="sm"
        data-test="logs-auto-run-guard-run-btn"
        @click="emit('run')"
      >
        {{ runLabel }}
      </OButton>
      <OButton
        v-if="narrowTo"
        variant="outline"
        size="sm"
        data-test="logs-auto-run-guard-narrow-btn"
        @click="emit('narrow', narrowTo.period)"
      >
        {{ narrowLabel }}
      </OButton>
      <OButton
        v-if="showSearchJob"
        variant="outline"
        size="sm"
        data-test="logs-auto-run-guard-search-job-btn"
        @click="emit('search-job')"
      >
        {{ t("search.autoRunGuardSearchJob") }}
      </OButton>
    </template>
  </OBanner>

  <OEmptyState
    v-else
    size="hero"
    illustration="query"
    variant="neutral"
    :hide-action="true"
    data-test="logs-auto-run-guard"
  >
    <template #title>{{ heroTitle }}</template>
    <template #description>
      <span data-test="logs-auto-run-guard-estimate">{{ heroDescription }}</span>
    </template>
    <template #actions>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <OButton
          v-if="isUnresolved"
          variant="primary"
          size="md"
          data-test="logs-auto-run-guard-select-stream-btn"
          @click="emit('select-stream')"
        >
          {{ t("search.autoRunGuardSelectStream") }}
        </OButton>
        <OButton
          v-if="showRun"
          variant="primary"
          size="md"
          icon-left="play-arrow"
          data-test="logs-auto-run-guard-run-btn"
          @click="emit('run')"
        >
          {{ runLabel }}
        </OButton>
        <OButton
          v-if="narrowTo"
          variant="outline"
          size="md"
          data-test="logs-auto-run-guard-narrow-btn"
          @click="emit('narrow', narrowTo.period)"
        >
          {{ narrowLabel }}
        </OButton>
        <OButton
          v-if="showSearchJob && !isUnresolved"
          variant="outline"
          size="md"
          data-test="logs-auto-run-guard-search-job-btn"
          @click="emit('search-job')"
        >
          {{ t("search.autoRunGuardSearchJob") }}
        </OButton>
      </div>
    </template>
    <template v-if="autoRunOn && !isUnresolved" #extra>
      <span class="text-text-secondary text-xs" data-test="logs-auto-run-guard-hint">
        {{ t("search.autoRunGuardHint") }}
      </span>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { formatSizeFromMB, timestampToTimezoneDate } from "@/utils/zincutils";
import { periodToLabel } from "@/composables/useWidenRange";
import type { AutoRunBlocked } from "@/composables/useLogs/useAutoRun";

const props = withDefaults(
  defineProps<{
    blocked: AutoRunBlocked;
    variant?: "empty" | "banner";
    autoRunOn?: boolean;
    showSearchJob?: boolean;
  }>(),
  { variant: "empty", autoRunOn: false, showSearchJob: false },
);

const emit = defineEmits<{
  run: [];
  narrow: [period: string];
  "search-job": [];
  "select-stream": [];
}>();

const { t } = useI18nTyped();
const store = useStore();

const MAX_NAMED_STREAMS = 3;

const reason = computed(() => props.blocked.decision?.reason ?? "over-threshold");
const isUnresolved = computed(() => reason.value === "unresolved");
const isSuperCluster = computed(
  () => reason.value === "unknown-unvalidated" && !!props.blocked.estimate?.superCluster,
);
const isUnknown = computed(
  () => reason.value === "unknown-window" || reason.value === "unknown-unvalidated",
);
const fromLink = computed(() => props.blocked.reasons?.includes("url"));
const fromRefresh = computed(() => props.blocked.reasons?.every((r) => r === "refresh"));
const showRun = computed(() => !isUnresolved.value);
const narrowTo = computed(() => (isUnresolved.value ? null : props.blocked.narrowTo));

const size = computed(() => raw(formatSizeFromMB(Math.max(0, props.blocked.estimateMb ?? 0))));

const streamsLabel = (names: string[]): I18nText => {
  const shown = names.slice(0, MAX_NAMED_STREAMS).join(", ");
  if (names.length <= MAX_NAMED_STREAMS) return raw(shown);
  return t("search.autoRunGuardMoreStreams", {
    streams: shown,
    count: names.length - MAX_NAMED_STREAMS,
  });
};

const windowLabel = computed<I18nText>(() => {
  const window = props.blocked.window;
  if (window.type === "relative") return raw(periodToLabel(window.period));
  const format = (us: number) =>
    timestampToTimezoneDate(us / 1000, store.state.timezone, "yyyy-MM-dd HH:mm");
  return raw(`${format(window.startUs)} – ${format(window.endUs)}`);
});

const scopeNames = computed(() => {
  const named = props.blocked.estimate?.streams?.map((s) => s.name) ?? [];
  return named.length ? named : props.blocked.streams;
});

const scope = computed(() =>
  t("search.autoRunGuardScope", {
    streams: streamsLabel(scopeNames.value),
    window: windowLabel.value,
  }),
);

const runLabel = computed(() =>
  isSuperCluster.value ? t("search.autoRunGuardRunQuery") : t("search.autoRunGuardRunAnyway"),
);

const narrowLabel = computed(() => {
  const candidate = narrowTo.value;
  if (!candidate) return raw("");
  const period = periodToLabel(candidate.period);
  if (candidate.estimate?.status === "known") {
    return t("search.autoRunGuardNarrowWithSize", {
      period,
      size: formatSizeFromMB(candidate.estimate.knownMb),
    });
  }
  return t("search.autoRunGuardNarrow", { period });
});

const heroTitle = computed(() => {
  if (isUnresolved.value) return t("search.autoRunGuardUnresolvedTitle");
  if (isSuperCluster.value) return t("search.autoRunGuardSuperClusterTitle");
  if (isUnknown.value) return t("search.autoRunGuardUnknownTitle");
  if (fromLink.value) return t("search.autoRunGuardLinkTitle", { size: size.value });
  return t("search.autoRunGuardTitle", { size: size.value });
});

const heroDescription = computed(() => {
  const estimate = props.blocked.estimate;
  if (isUnresolved.value) {
    const missing = estimate?.unresolvedSources?.length
      ? estimate.unresolvedSources
      : props.blocked.streams;
    return t("search.autoRunGuardUnresolvedDesc", { streams: streamsLabel(missing) });
  }
  if (isSuperCluster.value) return t("search.autoRunGuardSuperClusterDesc", { scope: scope.value });
  if (reason.value === "unknown-unvalidated") {
    return t(
      "search.autoRunGuardUnknownManyDesc",
      {
        count: estimate?.unknownStreams?.length ?? 0,
        scope: scope.value,
      },
      estimate?.unknownStreams?.length ?? 0,
    );
  }
  if (reason.value === "unknown-window") {
    return t("search.autoRunGuardUnknownDesc", {
      streams: streamsLabel(estimate?.unknownStreams ?? props.blocked.streams),
    });
  }
  if (fromLink.value) return t("search.autoRunGuardDescLink", { scope: scope.value });
  return props.autoRunOn
    ? t("search.autoRunGuardDescAutoRun", { scope: scope.value })
    : t("search.autoRunGuardDescPaused", { scope: scope.value });
});

const bannerText = computed(() => {
  if (isUnresolved.value || isSuperCluster.value) return heroDescription.value;
  if (isUnknown.value) return t("search.autoRunGuardBannerUnknown", { scope: scope.value });
  if (fromRefresh.value) {
    return t("search.autoRunGuardBannerRefresh", { size: size.value, scope: scope.value });
  }
  return props.autoRunOn
    ? t("search.autoRunGuardBanner", { size: size.value, scope: scope.value })
    : t("search.autoRunGuardBannerPaused", { size: size.value, scope: scope.value });
});
</script>
