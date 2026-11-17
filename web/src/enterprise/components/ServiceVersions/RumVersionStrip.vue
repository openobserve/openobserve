<template>
  <div
    v-if="state !== 'hidden'"
    :class="[
      'px-page-edge border-border-default bg-surface-panel flex min-h-11 shrink-0 items-center gap-2 border-b py-1.5 text-xs',
      state === 'hint' ? 'flex-nowrap' : 'flex-wrap',
    ]"
    :aria-label="t('serviceVersions.rum.strip.label')"
    data-test="svcver-rum-strip"
  >
    <RumNoVersionHint
      v-if="state === 'hint'"
      :app="hintApp"
      :env="rumHintContext.env || noVersionEntry?.env"
      :period="rumHintContext.period || undefined"
      @dismiss="dismiss"
    />
    <OIcon v-else name="flag" size="sm" class="text-text-secondary" />
    <template v-if="state === 'loading'">
      <OSkeleton class="h-5 w-96" data-test="svcver-rum-strip-loading" />
    </template>
    <template v-else-if="state === 'unavailable'">
      <span class="text-text-body" data-test="svcver-rum-strip-unavailable">{{
        t("serviceVersions.rum.strip.unavailable")
      }}</span
      ><span class="text-text-muted">·</span
      ><OButton variant="ghost" size="xs" data-test="svcver-rum-strip-retry" @click="retry">{{
        t("serviceVersions.actions.retry")
      }}</OButton>
    </template>
    <template v-else-if="scope">
      <ODropdown v-if="others.length" side="bottom" align="start">
        <template #trigger>
          <OButton
            variant="outline"
            size="xs"
            icon-right="arrow-drop-down"
            :aria-label="t('serviceVersions.rum.strip.switchApp')"
            data-test="svcver-rum-strip-app"
            ><b class="text-text-heading font-semibold">{{ scope.service }}</b
            ><span class="text-text-secondary" data-test="svcver-rum-strip-more-apps">{{
              others.length === 1
                ? t("serviceVersions.rum.strip.moreApp")
                : t("serviceVersions.rum.strip.moreApps", { count: others.length })
            }}</span></OButton
          >
        </template>
        <ODropdownItem
          v-for="row in others"
          :key="row.scope_key"
          :data-test="`svcver-rum-strip-app-option-${row.scope_key}`"
          @select="selectedKey = row.scope_key"
          ><span class="font-semibold">{{ row.service }}</span>
          <span class="text-text-secondary">{{ row.env }}</span></ODropdownItem
        >
      </ODropdown>
      <b v-else class="text-text-heading text-sm font-semibold" data-test="svcver-rum-strip-app">{{
        scope.service
      }}</b>
      <ServiceEnvChip :identity="scope" :service="scope.service" />
      <span class="text-text-muted">·</span>
      <span data-test="svcver-rum-strip-version"
        ><b class="text-text-heading font-mono font-semibold">{{ scope.newest_version }}</b>
        <span class="text-text-secondary ms-1">{{
          t("serviceVersions.rum.strip.deployed", { time: deployedAt })
        }}</span></span
      >
      <span
        v-if="rolledBackFrom"
        class="text-text-secondary"
        data-test="svcver-rum-strip-rolled-back"
        >{{ t("serviceVersions.rum.strip.rolledBackFrom", { version: rolledBackFrom }) }}</span
      >
      <template v-if="verdictsUnavailable">
        <span class="text-text-body" data-test="svcver-rum-strip-unavailable">{{
          t("serviceVersions.rum.strip.unavailable")
        }}</span
        ><span class="text-text-muted">·</span
        ><OButton variant="ghost" size="xs" data-test="svcver-rum-strip-retry" @click="retry">{{
          t("serviceVersions.actions.retry")
        }}</OButton>
      </template>
      <template v-else-if="verdict">
        <VerdictChip :verdict="verdict" :clickable="false" test-id="svcver-rum-strip-verdict" />
        <span v-if="summary" class="text-text-body" data-test="svcver-rum-strip-summary">{{
          summary
        }}</span>
      </template>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="svcver-rum-strip-compare"
        @click="compare"
        >{{ t("serviceVersions.actions.compare") }}</OButton
      >
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { isAxiosError } from "axios";
import { formatDeployTime } from "@/utils/serviceVersionsCopy";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import VerdictChip from "./VerdictChip.vue";
import RumNoVersionHint from "./RumNoVersionHint.vue";
import { type Scope } from "@/services/service_versions";
import { identityQuery, servicesQuery } from "@/services/service_versions.queries";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { rumHintContext, stripSummary } from "./rumStrip";
import { verdictCode } from "./verdictText";
const props = defineProps<{ app?: string; noVersionHint?: boolean }>();
const { t } = useI18nTyped();
const store = useStore();
const drawer = useVersionCompareDrawer();
const org = computed(() => store.state.selectedOrganization?.identifier || "");
const user = computed(() => store.state.userInfo?.email || "");
const tracesLock = useLicenseLock("traces");
const correlationLock = useLicenseLock("correlation");
const services = useQuery(
  computed(() => ({
    ...servicesQuery(org.value, user.value, { signal: "rum" }),
    enabled: Boolean(org.value && user.value && !tracesLock.locked.value),
  })),
);
const status = computed(() =>
  isAxiosError(services.error.value) ? services.error.value.response?.status : undefined,
);
const selectedKey = ref("");
watch(
  () => [org.value, props.app],
  () => (selectedKey.value = ""),
);
const versioned = computed(() =>
  (services.data.value?.services || [])
    .filter((row) => row.signals.includes("rum") && row.newest_version)
    .sort((a, b) => (b.newest_first_seen ?? 0) - (a.newest_first_seen ?? 0)),
);
const scope = computed<Scope | undefined>(() => {
  const picked = versioned.value.find((row) => row.scope_key === selectedKey.value);
  if (picked) return picked;
  if (props.app) return versioned.value.find((row) => row.service === props.app);
  return versioned.value[0];
});
const others = computed(() =>
  versioned.value.filter((row) => row.scope_key !== scope.value?.scope_key),
);
const hintApp = computed(() => (props.noVersionHint && props.app) || "");
const unresolved = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityUnresolved"),
    enabled: Boolean(org.value && user.value && hintApp.value && !correlationLock.locked.value),
  })),
);
const noVersionEntry = computed(() =>
  unresolved.data.value?.no_version.find(
    (row) => row.service === hintApp.value && row.signals.includes("rum"),
  ),
);
const storageKey = computed(() => `svcver.rumNoVersion.dismissed.${org.value}.${hintApp.value}`);
const dismissed = ref(false);
// Private browsing and quota errors make storage throw; the hint then stays dismissable for the page only.
function readDismissed() {
  try {
    return window.localStorage.getItem(storageKey.value) === "1";
  } catch {
    return false;
  }
}
watch(storageKey, () => (dismissed.value = readDismissed()), { immediate: true });
function dismiss() {
  dismissed.value = true;
  try {
    window.localStorage.setItem(storageKey.value, "1");
  } catch {
    return;
  }
}
const state = computed(() => {
  if (!org.value || !user.value || tracesLock.locked.value) return "hidden";
  if (services.isPending.value) return "loading";
  // 403 and a missing route mean no RUM scope to describe; any other failure stays visible with Retry.
  if (services.isError.value)
    return status.value === 403 || status.value === 404 ? "hidden" : "unavailable";
  if (scope.value) return "ready";
  if (!hintApp.value || dismissed.value || correlationLock.locked.value) return "hidden";
  if (unresolved.isPending.value) return "loading";
  // The hint needs both reads: a failed unresolved read is no proof the app sends no version.
  return noVersionEntry.value ? "hint" : "hidden";
});
const verdictsUnavailable = computed(() => services.data.value?.verdict_status === "unavailable");
const verdict = computed(() => scope.value?.newest_verdict || undefined);
const rolledBackFrom = computed(() =>
  verdict.value?.deploy?.kind === "rollback" ? verdict.value.deploy.from_version || "" : "",
);
const deployedAt = computed(() => {
  const at = verdict.value?.deploy?.at ?? scope.value?.newest_first_seen;
  return at ? formatDeployTime(at, Date.now(), store.state.timezone || "UTC") : "";
});
const summary = computed(() => (verdict.value ? stripSummary(verdict.value, t) : ""));
function retry() {
  void services.refetch();
}
function compare() {
  const row = scope.value;
  if (!row?.newest_version) return;
  void drawer.open({
    service: row.service,
    where: row.where_key,
    a: row.newest_version,
    deployKey:
      verdict.value && verdictCode(verdict.value) !== "pre_existing"
        ? verdict.value.deploy_key
        : undefined,
  });
}
</script>
