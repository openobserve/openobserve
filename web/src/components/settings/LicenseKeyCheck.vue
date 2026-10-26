<template>
  <div v-if="result || refusal" class="my-3" data-test="license-key-check">
    <OBanner
      :variant="accepted ? 'info' : 'error-soft'"
      :icon="accepted ? 'info' : 'cancel'"
      data-test="license-key-check-banner"
      >{{ message }}</OBanner
    >
    <template v-if="accepted">
      <div v-for="group in groups" :key="group.id" class="mt-3">
        <div class="text-text-secondary mb-1 text-xs">{{ group.label }}</div>
        <OTable
          :data="group.rows"
          :columns="columns"
          row-key="id"
          pagination="none"
          sorting="none"
          :frame="false"
          :show-global-filter="false"
          :table-id="`license-key-check-${group.id}`"
          :data-test="`license-key-check-${group.id}`"
        >
          <template #cell-waiver="{ row }">
            <span class="flex items-center gap-2">
              <span>{{ waiverKindLabel(row, t) }}</span>
              <OTag type="licenseWaiverStatus" :value="waiverStatus(row, nowUs)" />
            </span>
          </template>
          <template #cell-window="{ row }">{{ waiverWindowLabel(row, locale, t) }}</template>
        </OTable>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  boundaryDelayMs,
  breachRetentionEndUs,
  issuedOn,
  knownWaivers,
  waiverKindLabel,
  waiverWindowLabel,
  waiverStatus,
  type KeyCheckResult,
  type RevRefusal,
} from "@/utils/licenseWaivers";

const props = defineProps<{ result: KeyCheckResult | null; refusal: RevRefusal | null }>();
const { t, locale } = useI18nTyped();
const nowUs = ref(Date.now() * 1000);
const accepted = computed(() => !props.refusal && props.result?.outcome === "accept");
const groups = computed(() =>
  [
    {
      id: "added",
      label: t("about.key_check_added", { count: props.result?.waivers_added.length ?? 0 }),
      rows: knownWaivers(props.result?.waivers_added),
    },
    {
      id: "removed",
      label: t("about.key_check_removed", { count: props.result?.waivers_removed.length ?? 0 }),
      rows: knownWaivers(props.result?.waivers_removed),
    },
  ].filter((g) => g.rows.length),
);
const rows = computed(() => (accepted.value ? groups.value.flatMap((group) => group.rows) : []));
let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
const clearBoundaryTimer = () => {
  if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
  boundaryTimer = undefined;
};
const armBoundaryTimer = () => {
  clearBoundaryTimer();
  nowUs.value = Date.now() * 1000;
  const upcoming = rows.value
    .flatMap((waiver) => [
      waiver.starts_at,
      waiver.ends_at,
      ...(waiver.type === "breach_days" ? [breachRetentionEndUs(waiver)] : []),
    ])
    .filter((boundary) => boundary > nowUs.value);
  if (!upcoming.length) return;
  boundaryTimer = setTimeout(armBoundaryTimer, boundaryDelayMs(Math.min(...upcoming), nowUs.value));
};
watch(rows, armBoundaryTimer, { immediate: true });
onBeforeUnmount(clearBoundaryTimer);

const columns = computed<OTableColumnDef[]>(() => [
  { id: "waiver", header: t("about.waiver_col_waiver"), cell: " ", size: 300 },
  { id: "window", header: t("about.waiver_col_window"), cell: " ", size: 270 },
  {
    id: "note",
    header: t("about.waiver_col_note"),
    accessorKey: "note",
    meta: { autoWidth: true, fillRemaining: true },
  },
]);
const message = computed(() => {
  const outcome = props.refusal?.reason ?? props.result?.outcome;
  const loaded = props.refusal?.loaded_rev ?? props.result?.loaded_rev ?? 0;
  const pasted = props.refusal?.pasted_rev ?? props.result?.pasted_rev ?? 0;
  if (outcome === "accept") {
    if (!props.result?.same_license)
      return t("about.key_check_accept_other", { id: props.result?.license_id });
    return t(
      props.result.waivers_added.length || props.result.waivers_removed.length
        ? "about.key_check_accept_same"
        : "about.key_check_accept_unchanged",
    );
  }
  if (outcome === "rev_conflict")
    return t("about.key_refused_conflict", { product: raw("OpenObserve") });
  if (outcome === "superseded") return t("about.key_refused_superseded");
  if (outcome === "env_key_conflict")
    return t("about.key_refused_env", { variable: raw("O2_LICENSE_KEY") });
  if (!pasted)
    return t(
      loaded ? "about.key_refused_rollback_undated" : "about.key_refused_rollback_unavailable",
      { loaded: issuedOn(loaded, locale.value) },
    );
  const sameDay = issuedOn(loaded, locale.value) === issuedOn(pasted, locale.value);
  const date = (rev: number) =>
    sameDay
      ? `${issuedOn(rev, locale.value)}, ${new Intl.DateTimeFormat(locale.value, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(rev / 1000))} UTC`
      : issuedOn(rev, locale.value);
  return t("about.key_refused_rollback", { loaded: date(loaded), pasted: date(pasted) });
});
</script>
