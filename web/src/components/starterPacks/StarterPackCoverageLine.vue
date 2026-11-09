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
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { readQuery } from "@/composables/query/readQuery";
import { KUBERNETES_PACK, STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { matchPack, readOrgStreams } from "@/composables/starterPacks/packMatchData";
import type { StarterPack } from "@/composables/starterPacks/types";
import { useInstallRecords } from "@/composables/starterPacks/useInstallRecords";
import { alertsByTagsQuery } from "@/services/alerts.queries";
import { useI18nTyped } from "@/types/i18n";
import { DETECTION_STREAMS } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";

type Gap = { pack: StarterPack; installed: boolean };

const props = defineProps<{ org: string; refreshKey?: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const records = useInstallRecords(props.org);
const { loadManifest, loadAlertFile } = useAlertLibrary();

const matchedPacks = ref<StarterPack[]>([]);
const reported = ref(0);
const gaps = ref<Gap[]>([]);

const signalsOf = (pack: StarterPack) =>
  pack.id === KUBERNETES_PACK.id ? DETECTION_STREAMS : (pack.signals ?? []);

// Without a signal stream the pack cannot fit, so the full match is not paid for on this hot page.
const matches = async (
  pack: StarterPack,
  streams: Awaited<ReturnType<typeof readOrgStreams>>,
): Promise<boolean> => {
  const metrics = streams.metrics ?? new Map();
  if (!signalsOf(pack).some((name) => metrics.has(name))) return false;
  return (await matchPack(props.org, pack, streams, { loadManifest, loadAlertFile })).ready;
};

// A pack counts as covered only once one of its alerts is on, since pack alerts install silent.
const gapOf = async (pack: StarterPack, force: boolean): Promise<Gap | null> => {
  const installs = await records.list(pack.id);
  if (!installs.some(({ status }) => status !== "removed")) return { pack, installed: false };
  const alerts = await readQuery(alertsByTagsQuery(props.org, [`pack:${pack.id}`]), force);
  return alerts.some((alert) => alert.enabled) ? null : { pack, installed: true };
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
  const results = await settled(
    matchedPacks.value.map(async (pack) => ({ pack, gap: await gapOf(pack, force) })),
  );
  if (mine !== run) return;
  reported.value = results.length;
  gaps.value = results.flatMap(({ gap }) => (gap ? [gap] : []));
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

const open = (pack: StarterPack) =>
  router
    .push({ name: "starterPack", params: { pack: pack.id }, query: { org_identifier: props.org } })
    .catch(() => {});
</script>

<template>
  <OBanner
    v-if="reported > 0"
    :variant="gaps.length ? 'info' : 'success'"
    dense
    inline-actions
    data-test="starter-pack-coverage-line"
  >
    {{ t("starterPacks.coverage.line", { on: reported - gaps.length, matched: reported }) }}
    <template v-if="gaps.length" #actions>
      <OButton
        v-for="gap in gaps"
        :key="gap.pack.id"
        variant="ghost-primary"
        size="sm-action"
        :data-test="`starter-pack-coverage-link-${gap.pack.id}`"
        @click="open(gap.pack)"
      >
        {{
          gap.installed
            ? t("starterPacks.coverage.turnOn", { title: t(gap.pack.titleKey) })
            : t("starterPacks.coverage.setUp", { title: t(gap.pack.titleKey) })
        }}
      </OButton>
    </template>
  </OBanner>
</template>
