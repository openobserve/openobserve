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

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { readQuery } from "@/composables/query/readQuery";
import { KUBERNETES_PACK, STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { matchPack, readOrgStreams } from "@/composables/starterPacks/packMatchData";
import type { StarterPack } from "@/composables/starterPacks/types";
import { useInstallRecords } from "@/composables/starterPacks/useInstallRecords";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { alertsByTagsQuery } from "@/services/alerts.queries";
import { useI18nTyped } from "@/types/i18n";
import { DETECTION_STREAMS } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";
import StarterPackDrawer from "./StarterPackDrawer.vue";

type Gap = { pack: StarterPack; installed: boolean };
type PackAlert = {
  enabled: boolean;
  alert_type?: string;
  destinations?: string[];
  last_triggered_at?: number | null;
};

const WEEK_US = 7 * 24 * 60 * 60 * 1_000_000;

const props = defineProps<{ org: string; refreshKey?: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const records = useInstallRecords(props.org);
const { loadManifest, loadAlertFile } = useAlertLibrary();

const matchedPacks = ref<StarterPack[]>([]);
const reported = ref(0);
const gaps = ref<Gap[]>([]);
const fitCounts = ref<Record<string, number>>({});
const silent = ref(0);
const flows = new Map(STARTER_PACKS.map((pack) => [pack.id, useStarterPackFlow(props.org, pack)]));
const drawerPackId = ref<string | null>(null);
const drawerFlow = computed(() => (drawerPackId.value ? flows.get(drawerPackId.value) : undefined));

const signalsOf = (pack: StarterPack) =>
  pack.id === KUBERNETES_PACK.id ? DETECTION_STREAMS : (pack.signals ?? []);

// Without a signal stream the pack cannot fit, so the full match is not paid for on this hot page.
const matches = async (
  pack: StarterPack,
  streams: Awaited<ReturnType<typeof readOrgStreams>>,
): Promise<boolean> => {
  const metrics = streams.metrics ?? new Map();
  if (!signalsOf(pack).some((name) => metrics.has(name))) return false;
  const match = await matchPack(props.org, pack, streams, { loadManifest, loadAlertFile });
  if (match.alerts) {
    const fit = [...match.alerts.values()].filter(Boolean).length;
    fitCounts.value = { ...fitCounts.value, [pack.id]: fit };
  }
  return match.ready;
};

// The list drops destinations for composites, so only a non-composite with none is silent.
const isSilent = (alert: PackAlert, since: number) =>
  alert.alert_type !== "composite" &&
  !alert.destinations?.length &&
  (alert.last_triggered_at ?? 0) >= since;

// A pack counts as covered only once one of its alerts is on, since pack alerts install silent.
const gapOf = async (
  pack: StarterPack,
  force: boolean,
): Promise<{ gap: Gap | null; silent: number }> => {
  const installs = await records.list(pack.id);
  if (!installs.some(({ status }) => status !== "removed")) {
    return { gap: { pack, installed: false }, silent: 0 };
  }
  const alerts: PackAlert[] = await readQuery(
    alertsByTagsQuery(props.org, [`pack:${pack.id}`], true),
    force,
  );
  const since = Date.now() * 1000 - WEEK_US;
  const quiet = alerts.filter((alert) => isSilent(alert, since)).length;
  return {
    gap: alerts.some((alert) => alert.enabled) ? null : { pack, installed: true },
    silent: quiet,
  };
};

// A pack whose read fails drops out alone, so the others still report.
const settled = async <T,>(work: Promise<T>[]) =>
  (await Promise.allSettled(work)).flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

let run = 0;
const loadGaps = async (force: boolean) => {
  run += 1;
  const mine = run;
  const results = await settled(matchedPacks.value.map(async (pack) => gapOf(pack, force)));
  if (mine !== run) return;
  reported.value = results.length;
  gaps.value = results.flatMap(({ gap }) => (gap ? [gap] : []));
  silent.value = results.reduce((sum, result) => sum + result.silent, 0);
};

onMounted(async () => {
  const streams = await readOrgStreams(props.org).catch(() => null);
  if (!streams) return;
  const found = await settled(
    STARTER_PACKS.map(async (pack) => ((await matches(pack, streams)) ? pack : null)),
  );
  matchedPacks.value = found.filter((pack): pack is StarterPack => pack !== null);
  await loadGaps(false);
});

// A toggle or reload in the list below can turn a pack's alerts on or off.
watch(
  () => props.refreshKey,
  () => {
    if (matchedPacks.value.length) void loadGaps(true);
  },
);

const routeAlerts = () =>
  router.push({ name: "alertDestinations", query: { org_identifier: props.org } }).catch(() => {});
const alertCount = (pack: StarterPack) => flows.get(pack.id)?.alertCount.value ?? 0;
const open = (pack: StarterPack) =>
  router
    .push({ name: "starterPack", params: { pack: pack.id }, query: { org_identifier: props.org } })
    .catch(() => {});
</script>

<template>
  <div v-if="silent > 0 || gaps.length" class="flex flex-col gap-2 px-3 py-2">
    <OBanner
      v-if="silent > 0"
      variant="error-soft"
      dense
      inline-actions
      data-test="starter-pack-coverage-silent"
    >
      {{ t("starterPacks.coverage.silent", { count: silent }, silent) }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-coverage-route-btn"
          @click="routeAlerts"
        >
          {{ t("starterPacks.coverage.route") }}
        </OButton>
      </template>
    </OBanner>
    <div
      v-if="gaps.length"
      class="border-border-default rounded-default flex flex-col border"
      data-test="starter-pack-coverage-line"
    >
      <div
        v-for="gap in gaps"
        :key="gap.pack.id"
        class="border-border-default flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
        :data-test="`starter-pack-coverage-row-${gap.pack.id}`"
      >
        <OIcon name="hub" size="md" class="text-text-secondary shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="flex items-center gap-2">
            <strong>{{ t(gap.pack.titleKey) }}</strong>
            <OBadge
              v-if="fitCounts[gap.pack.id]"
              variant="success-soft"
              :data-test="`starter-pack-coverage-fit-${gap.pack.id}`"
            >
              {{ t("starterPacks.coverage.fit", { count: fitCounts[gap.pack.id] }) }}
            </OBadge>
          </span>
          <OText variant="meta" class="truncate">{{ t(gap.pack.descriptionKey) }}</OText>
        </div>
        <OButton
          v-if="gap.installed"
          variant="outline"
          size="sm-action"
          :data-test="`starter-pack-coverage-link-${gap.pack.id}`"
          @click="open(gap.pack)"
        >
          {{ t("starterPacks.coverage.turnOn", { title: t(gap.pack.titleKey) }) }}
        </OButton>
        <template v-else>
          <OButton
            variant="primary"
            size="sm-action"
            :data-test="`starter-pack-coverage-install-${gap.pack.id}`"
            @click="drawerPackId = gap.pack.id"
          >
            {{
              t(
                "starterPacks.coverage.install",
                { count: alertCount(gap.pack) },
                alertCount(gap.pack),
              )
            }}
          </OButton>
          <OButton
            variant="ghost-primary"
            size="sm-action"
            :data-test="`starter-pack-coverage-see-${gap.pack.id}`"
            @click="drawerPackId = gap.pack.id"
          >
            {{ t("starterPacks.card.seeIncluded") }}
          </OButton>
        </template>
      </div>
    </div>
    <StarterPackDrawer
      v-if="drawerFlow"
      :open="true"
      :flow="drawerFlow"
      :clusters="[]"
      @update:open="drawerPackId = null"
    />
  </div>
</template>
