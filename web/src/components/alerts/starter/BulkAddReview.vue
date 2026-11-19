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
  <section class="flex min-h-0 flex-col gap-3" data-test="alerts-bulk-add-review">
    <header class="flex items-baseline gap-2">
      <h3 class="text-text-heading text-sm font-semibold">
        {{ t("alertStarter.bulk.heading", { count: rows.length }, rows.length) }}
      </h3>
      <span class="text-text-secondary text-xs">{{ t("alertStarter.bulk.nothingYet") }}</span>
    </header>

    <div
      class="border-border-default rounded-default grid items-end gap-3 border p-3 sm:grid-cols-2"
      :inert="locked || undefined"
      data-test="alerts-bulk-add-review-settings"
    >
      <OSkeleton
        v-if="foldersLoading"
        type="rect"
        class="rounded-default h-14 w-full"
        data-test="alerts-bulk-add-review-folder-loading"
      />
      <div v-else class="min-w-0" data-test="alerts-bulk-add-review-folder">
        <SelectFolderDropDown
          :active-folder-id="folderId"
          type="alerts"
          @folder-selected="onFolderSelected"
        />
      </div>
      <div class="min-w-0" data-test="alerts-bulk-add-review-scope">
        <StarterScopeSelect v-model="scope" />
      </div>
      <div class="flex min-w-0 flex-col gap-1 sm:col-span-2" data-test="alerts-bulk-add-review-who">
        <WhoToTell
          v-model="destinations"
          :stream-type="sharedStream?.type"
          :stream-name="sharedStream?.name"
        />
        <!-- Always one line, so choosing a destination never moves the rows below. -->
        <p
          class="flex items-center gap-1 text-xs"
          :class="destinations.length ? 'text-text-secondary' : 'text-status-warning'"
          data-test="alerts-bulk-add-review-who-line"
        >
          <OIcon v-if="!destinations.length" name="warning" size="xs" class="shrink-0" />
          <OTruncatedText as="span">{{ whoLine }}</OTruncatedText>
        </p>
      </div>
      <OSelect
        v-model="interval"
        size="sm"
        :label="t('alertStarter.bulk.checkEvery')"
        :options="intervalOptions"
        data-test="alerts-bulk-add-review-interval"
      />
    </div>

    <p class="text-text-secondary text-xs" data-test="alerts-bulk-add-review-count">
      {{ t("alertStarter.bulk.listHeading", { count: rows.length }, rows.length) }}
    </p>

    <p
      v-if="rows.length === 0"
      class="text-text-secondary text-sm"
      data-test="alerts-bulk-add-review-empty"
    >
      {{ t("alertStarter.bulk.empty") }}
    </p>
    <ul
      v-else
      class="border-border-default rounded-default divide-border-default max-h-80 min-h-0 divide-y overflow-y-auto border"
      :aria-busy="installer.isInstalling.value || undefined"
      data-test="alerts-bulk-add-review-rows"
    >
      <li
        v-for="row in rows"
        :key="row.entry.id"
        class="flex items-center gap-2 px-3 py-1.5"
        :data-test="`alerts-bulk-add-review-row-${row.entry.id}`"
        :data-status="row.result?.status ?? 'review'"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <OTruncatedText as="span" class="text-text-heading text-sm">{{
            row.title
          }}</OTruncatedText>
          <OTag variant="default-outline" size="sm" class="shrink-0">{{ row.queryLabel }}</OTag>
          <OTag
            v-if="row.duplicates > 0"
            variant="warning-soft"
            size="sm"
            class="shrink-0"
            :data-test="`alerts-bulk-add-review-duplicate-${row.entry.id}`"
          >
            {{ t("alertStarter.bulk.duplicate", { count: row.duplicates }, row.duplicates) }}
          </OTag>
        </div>

        <div
          class="flex w-64 min-w-0 shrink-0 items-center justify-end gap-1 text-xs max-md:w-36"
          :data-test="`alerts-bulk-add-review-outcome-${row.entry.id}`"
        >
          <template v-if="row.result">
            <OSpinner v-if="row.result.status === 'running'" size="xs" />
            <OIcon
              v-else
              :name="statusIcon(row.result.status)"
              size="xs"
              class="shrink-0"
              :class="statusClass(row.result.status)"
            />
            <OTruncatedText as="span" :class="statusClass(row.result.status)">{{
              row.result.message ?? statusText(row.result.status)
            }}</OTruncatedText>
          </template>
          <template v-else-if="row.test.tone === 'loading'">
            <span class="sr-only">{{ t("alertStarter.bulk.testing") }}</span>
            <OSkeleton type="text" animation="none" class="h-3 w-32" />
          </template>
          <OTruncatedText v-else-if="row.test.text" as="span" :class="toneClass(row.test.tone)">{{
            row.test.text
          }}</OTruncatedText>
        </div>

        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="close"
          class="shrink-0"
          :title="t('alertStarter.bulk.remove', { title: row.title })"
          :disabled="locked"
          :data-test="`alerts-bulk-add-review-remove-${row.entry.id}`"
          @click="remove(row.entry.id)"
        />
      </li>
    </ul>

    <footer
      class="flex min-h-8 items-center justify-end gap-2"
      data-test="alerts-bulk-add-review-footer"
    >
      <template v-if="finishedWithFailures">
        <p
          class="text-status-negative me-auto min-w-0 text-sm"
          role="alert"
          data-test="alerts-bulk-add-review-summary"
        >
          {{ summaryText }}
        </p>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          :loading="installer.isInstalling.value"
          data-test="alerts-bulk-add-review-retry"
          @click="run(installer.failedIds.value)"
        >
          {{ t("alertStarter.bulk.retryFailed") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="installer.isInstalling.value"
          data-test="alerts-bulk-add-review-done"
          @click="emit('done', created)"
        >
          {{ t("alertStarter.bulk.done") }}
        </OButton>
      </template>
      <template v-else>
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="locked"
          data-test="alerts-bulk-add-review-back"
          @click="emit('back')"
        >
          {{ t("alertStarter.bulk.back") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="installer.isInstalling.value"
          :disabled="rows.length === 0"
          data-test="alerts-bulk-add-review-add"
          @click="run(rows.map((row) => row.entry.id))"
        >
          {{ t("alertStarter.bulk.add", { count: rows.length }, rows.length) }}
        </OButton>
      </template>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQueries } from "@tanstack/vue-query";

import { alertTypeOf, queryTypeLabel } from "@/components/alertLibrary/libraryFacets";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import type { StarterScope } from "@/components/create-starter/createStarter.types";
import StarterScopeSelect from "@/components/alerts/starter/StarterScopeSelect.vue";
import WhoToTell from "@/components/alerts/starter/WhoToTell.vue";
import { createAlertTestRun, type AlertTestRun } from "@/composables/alerts/useAlertTestRun";
import {
  useLibraryInstall,
  type InstallBatch,
  type InstallStatus,
} from "@/composables/alerts/useLibraryInstall";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { librarySuggestionsQuery } from "@/services/alert_library.queries";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { EvaluateAlertBody, EvaluateAlertResponse } from "@/utils/alerts/alertEvaluate.types";
import { testRunDay, testRunKey } from "@/utils/alerts/alertTestRun";
import type { LibrarySuggestQuery } from "@/utils/alerts/librarySuggest.types";
import { getFoldersListByType } from "@/utils/commons";

const props = defineProps<{
  entries: AlertLibraryEntry[];
  scope: StarterScope;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "done", created: number): void;
}>();

// Evaluate runs are heavy searches; three at once keeps a 30-row batch from flooding the server.
const MAX_TESTS = 3;
const INTERVALS = [1, 5, 10, 15, 30, 60];
const OWN_INTERVAL = 0;
const STREAM_TYPES = ["logs", "metrics", "traces"] as const;

type Tone = "loading" | "body" | "warning" | "error";

interface RowTest {
  tone: Tone;
  text: I18nText | null;
  key: string | null;
}

const { t } = useI18nTyped();
const store = useStore();
const installer = useLibraryInstall();

const org = (): string => store.state.selectedOrganization?.identifier ?? "";

const folderId = ref("default");
const foldersLoading = ref(true);
const scope = ref<StarterScope>(props.scope);
const destinations = ref<string[]>([]);
const interval = ref<number>(OWN_INTERVAL);
const removed = ref<Set<string>>(new Set());
const tests = ref<Record<string, RowTest>>({});
const created = ref(0);

const kept = computed(() => {
  const seen = new Set<string>();
  return props.entries.filter((entry) => {
    if (removed.value.has(entry.id) || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
});

const hasRun = computed(() => installer.hasRun.value);
const locked = computed(() => installer.isInstalling.value || hasRun.value);
const finishedWithFailures = computed(() => hasRun.value && installer.failedIds.value.length > 0);

const batch = computed<InstallBatch>(() => ({
  folderId: folderId.value,
  destinations: destinations.value,
  scope: scope.value,
  overrides: interval.value === OWN_INTERVAL ? undefined : { frequency: interval.value },
}));

// ── duplicates ─────────────────────────────────────────────────────────────
const suggestQueries = computed<LibrarySuggestQuery[]>(() => {
  const byKey = new Map<string, LibrarySuggestQuery>();
  for (const entry of kept.value) {
    const type = STREAM_TYPES.find((kind) => kind === entry.stream_type);
    if (!type || !entry.stream) continue;
    const alertType = entry.alert_type ?? "scheduled";
    byKey.set(`${type}\u0000${entry.stream}\u0000${alertType}`, {
      stream_type: type,
      stream_name: entry.stream,
      alert_type: alertType,
      limit: 50,
    });
  }
  return [...byKey.values()];
});

const suggestions = useQueries({
  queries: () =>
    suggestQueries.value.map((query) => ({
      ...librarySuggestionsQuery(org(), query),
      enabled: !!org(),
    })),
});

const duplicatesById = computed(() => {
  const counts = new Map<string, number>();
  for (const answer of suggestions.value) {
    for (const suggestion of answer.data?.suggestions ?? []) {
      if (suggestion.already_set_up.length) {
        counts.set(suggestion.id, suggestion.already_set_up.length);
      }
    }
  }
  return counts;
});

// ── rows ───────────────────────────────────────────────────────────────────
const rows = computed(() => {
  const results = new Map(installer.results.value.map((result) => [result.id, result]));
  return kept.value.map((entry) => ({
    entry,
    title: raw(entry.title),
    queryLabel: queryTypeLabel(entry.query_type),
    duplicates: duplicatesById.value.get(entry.id) ?? 0,
    result: results.get(entry.id) ?? null,
    test: tests.value[entry.id] ?? { tone: "loading" as const, text: null, key: null },
  }));
});

/** One stream for the whole batch, so Who to tell can guess; mixed batches guess nothing. */
const sharedStream = computed(() => {
  const streams = new Set(kept.value.map((entry) => `${entry.stream_type}\u0000${entry.stream}`));
  if (streams.size !== 1) return null;
  const [type, name] = [...streams][0].split("\u0000");
  return { type, name };
});

const whoLine = computed<I18nText>(() =>
  destinations.value.length
    ? t("alertStarter.bulk.appliesToAll", { count: kept.value.length }, kept.value.length)
    : t("alertStarter.whoToTell.nobodyTold"),
);

const intervalOptions = computed(() => [
  { label: t("alertStarter.bulk.intervalOwn"), value: OWN_INTERVAL },
  ...INTERVALS.map((minutes) => ({
    label: t("alertStarter.bulk.intervalMinutes", { count: minutes }, minutes),
    value: minutes,
  })),
]);

const summaryText = computed<I18nText>(() => {
  const failed = installer.failedIds.value.length;
  const added = installer.results.value.length - failed;
  return t("alertStarter.bulk.summaryFailed", {
    added: t("alertStarter.bulk.summaryAdded", { count: added }, added),
    count: failed,
  });
});

const statusIcon = (status: InstallStatus) => {
  if (status === "installed") return "check-circle";
  if (status === "failed") return "error-outline";
  return "schedule";
};

const statusClass = (status: InstallStatus) => {
  if (status === "installed") return "text-status-positive";
  if (status === "failed") return "text-status-negative";
  return "text-text-secondary";
};

const statusText = (status: InstallStatus): I18nText => {
  if (status === "installed") return t("alertStarter.bulk.added");
  if (status === "running") return t("alertStarter.bulk.adding");
  return t("alertStarter.bulk.waiting");
};

const toneClass = (tone: Tone) => {
  if (tone === "warning") return "text-status-warning";
  if (tone === "error") return "text-status-negative";
  return "text-text-secondary";
};

// ── 24 h test ──────────────────────────────────────────────────────────────
const runners = new Map<string, AlertTestRun>();
let testGeneration = 0;

const setTest = (id: string, test: RowTest) => {
  tests.value = { ...tests.value, [id]: test };
};

const verdict = (r: EvaluateAlertResponse): Pick<RowTest, "tone" | "text"> => {
  const failedCheck = r.checks.find((check) => check.error);
  if (r.summary.checks > 0 && r.summary.errors === r.summary.checks && failedCheck?.error) {
    return {
      tone: "error",
      text: t("alertStarter.bulk.testFailed", { reason: raw(failedCheck.error.message) }),
    };
  }
  const day = testRunDay(r);
  if (day.events === 0) return { tone: "warning", text: t("alertStarter.bulk.noData") };
  if (day.fired === 0) return { tone: "body", text: t("alertStarter.bulk.quiet") };
  const groups = r.summary.groups_fired_total;
  return groups > 0
    ? { tone: "body", text: t("alertStarter.bulk.firedGroups", { count: groups }, groups) }
    : { tone: "body", text: t("alertStarter.bulk.firedTimes", { count: day.fired }, day.fired) };
};

const testOne = async (entry: AlertLibraryEntry, settings: InstallBatch, generation: number) => {
  if (alertTypeOf(entry) === "anomaly") {
    setTest(entry.id, { tone: "body", text: t("alertStarter.bulk.learnsFirst"), key: null });
    return;
  }
  let body: EvaluateAlertBody;
  try {
    body = (await installer.prepare(entry, settings)).payload as EvaluateAlertBody;
  } catch (error) {
    const reason = installer.errorText(error);
    setTest(entry.id, {
      tone: "error",
      text: t("alertStarter.bulk.testFailed", { reason }),
      key: null,
    });
    return;
  }
  const key = testRunKey(body);
  if (generation !== testGeneration || tests.value[entry.id]?.key === key) return;

  setTest(entry.id, { tone: "loading", text: null, key: null });
  const runner = runners.get(entry.id) ?? createAlertTestRun();
  runners.set(entry.id, runner);
  await runner.run(org(), body, t, settings.folderId);
  if (generation !== testGeneration) return;
  if (runner.state.value === "ready" && runner.result.value) {
    setTest(entry.id, { ...verdict(runner.result.value), key });
  } else if (runner.state.value === "failed") {
    const reason = runner.failure.value ?? raw("");
    setTest(entry.id, { tone: "error", text: t("alertStarter.bulk.testFailed", { reason }), key });
  }
};

const runTests = async () => {
  testGeneration += 1;
  const generation = testGeneration;
  runners.forEach((runner) => runner.cancel());
  const queue = [...kept.value];
  const settings: InstallBatch = JSON.parse(JSON.stringify(batch.value));
  const worker = async () => {
    while (queue.length > 0 && generation === testGeneration) {
      const entry = queue.shift();
      if (entry) await testOne(entry, settings, generation);
    }
  };
  await Promise.all(Array.from({ length: MAX_TESTS }, worker));
};

watch(
  () => props.scope,
  (next) => {
    scope.value = next;
  },
);
// Folder and destinations are not evaluated, so only a change that alters the query re-tests.
watch([scope, interval], () => void runTests(), { deep: true });

// ── actions ────────────────────────────────────────────────────────────────
const onFolderSelected = (folder: { value?: string }) => {
  folderId.value = folder?.value ?? "default";
};

const remove = (id: string) => {
  removed.value = new Set([...removed.value, id]);
};

const run = async (ids: string[]) => {
  const outcome = await installer.install(kept.value, ids, batch.value);
  if (!outcome) return;
  created.value += outcome.installedIds.length;
  if (installer.failedIds.value.length === 0) emit("done", created.value);
};

onMounted(() => {
  void getFoldersListByType(store, "alerts")
    .catch(() => {
      // The picker still offers "default", which is a valid folder.
    })
    .finally(() => {
      foldersLoading.value = false;
    });
  void runTests();
});

onBeforeUnmount(() => {
  testGeneration += 1;
  runners.forEach((runner) => runner.cancel());
});
</script>
