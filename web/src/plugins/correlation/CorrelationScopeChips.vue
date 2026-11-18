<template>
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <span v-if="scope && showEnv" class="inline-flex" data-test="svcver-correlation-env-chip"
      ><ServiceEnvChip :identity="scope" :service="scope.service"
    /></span>
    <span v-if="shownVersion" class="inline-flex" data-test="svcver-correlation-version"
      ><ServiceScopeChip facet="version" :value="shownVersion"
    /></span>
    <button
      v-if="verdict"
      type="button"
      class="border-accent flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-solid px-1.5 py-0.5"
      data-test="svcver-correlation-rollout-verdict"
      @click="openCompare"
    >
      <span class="text-text-secondary text-xs">{{ verdictLabel }}</span>
      <VerdictChip
        :verdict="verdict"
        :clickable="false"
        test-id="svcver-correlation-verdict-chip"
      />
      <OIcon name="arrow-forward" size="xs" />
    </button>
    <span class="flex-1" />
    <ODropdown
      v-if="menu"
      side="bottom"
      align="end"
      content-class="max-h-80 overflow-y-auto"
      @update:open="(open) => !open && (expanded = false)"
    >
      <template #trigger>
        <OButton
          variant="outline"
          size="sm-action"
          icon-right="expand-more"
          data-test="svcver-correlation-open-service"
        >
          <OIcon name="account-tree" size="xs" class="me-1" />
          {{ t("serviceVersions.correlation.versionsAndDeploys") }}
        </OButton>
      </template>
      <ODropdownItem
        v-for="name in menu.shown"
        :ref="(item) => setCandidateItem(name, item)"
        :key="name"
        :data-test="`svcver-correlation-open-service-${name}`"
        @select="openService(name)"
        >{{ raw(name) }}</ODropdownItem
      >
      <ODropdownItem
        v-if="menu.more"
        data-test="svcver-correlation-open-service-more"
        @select="showAllCandidates"
      >
        {{ t("serviceVersions.correlation.moreServices", { count: menu.more }) }}
        <template #icon-right><OIcon name="expand-more" size="xs" class="ms-auto" /></template>
      </ODropdownItem>
    </ODropdown>
    <OButton
      v-else
      variant="outline"
      size="sm-action"
      data-test="svcver-correlation-open-service"
      @click="openService(scope?.service || service)"
    >
      <OIcon name="account-tree" size="xs" class="me-1" />
      {{ t("serviceVersions.correlation.versionsAndDeploys") }}
    </OButton>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Scope } from "@/services/service_versions";
import { isExplicitEnv } from "@/services/service_versions.envs";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import VerdictChip from "@/enterprise/components/ServiceVersions/VerdictChip.vue";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { verdictCode } from "@/enterprise/components/ServiceVersions/verdictText";
import { compareTitle, versionImageLabel } from "@/utils/serviceVersionsCopy";
import { shownVersionDetail } from "@/plugins/traces/servicesCatalogVersions";
import { candidateMenu, headerVersion } from "./correlationHeader";
const props = defineProps<{
  scope: Scope | null;
  service: string;
  /** The version the log's own instance runs; undefined while it is still being read. */
  instanceVersion: string | null | undefined;
  /** The services an ambiguous name covers; each is offered in the menu. */
  candidates?: string[];
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const compareDrawer = useVersionCompareDrawer();
const verdict = computed(() => props.scope?.newest_verdict ?? null);
const ambiguous = computed(() => (props.candidates?.length ?? 0) > 0);
const expanded = ref(false);
const candidateItems = new Map<string, HTMLElement>();
const menu = computed(() =>
  ambiguous.value ? candidateMenu(props.candidates ?? [], expanded.value) : null,
);
// An env read from the cluster or namespace name only repeats the Correlated by row.
const showEnv = computed(() => !!props.scope && isExplicitEnv(props.scope));
// The version serving now, as the catalog row shows it; the newest one may have stopped.
const serviceVersion = computed(() => {
  const scope = props.scope;
  if (!scope) return "";
  const detail = shownVersionDetail(scope);
  const version = scope.current_version || scope.newest_version || "";
  return version ? versionImageLabel(version, detail.image, detail.versionImages, t) : "";
});
const shownVersion = computed(() =>
  props.instanceVersion === undefined
    ? ""
    : headerVersion({
        ambiguous: ambiguous.value,
        instanceVersion: props.instanceVersion,
        serviceVersion: serviceVersion.value,
      }),
);
const verdictLabel = computed(() => {
  const value = verdict.value;
  const to = value?.version
    ? versionImageLabel(value.version, value.image, value.version_images, t)
    : serviceVersion.value;
  const base = value?.baseline;
  const from = base?.version
    ? versionImageLabel(base.version, base.image, base.version_images, t)
    : "";
  if (!from) return t("serviceVersions.correlation.deployVerdictFirst", { to });
  const { suffix } = compareTitle(
    {
      compared: to,
      baseline: from,
      kind: verdict.value?.deploy?.kind,
      notServing: verdict.value ? verdictCode(verdict.value) === "not_serving" : false,
    },
    t,
  );
  const label = t("serviceVersions.correlation.deployVerdict", { from, to });
  return suffix ? raw(`${label} ${suffix}`) : label;
});
// The correlation drawer has no URL state, so it closes first and Back then closes only the compare drawer.
function openCompare() {
  const scope = props.scope;
  if (!verdict.value || !scope) return;
  emit("close");
  void compareDrawer.open({
    service: scope.service,
    where: scope.where_key,
    a: verdict.value.version || scope.newest_version || "",
    aImage: verdict.value.image || undefined,
    deployKey: verdict.value.deploy_key,
  });
}
// The menu stays open and focus moves to the first revealed service, since the focused row is removed.
function showAllCandidates(event?: Event) {
  event?.preventDefault();
  const first = menu.value?.shown.length ?? 0;
  expanded.value = true;
  void nextTick(() => {
    const name = menu.value?.shown[first];
    if (name) candidateItems.get(name)?.focus();
  });
}
function setCandidateItem(name: string, item: unknown) {
  const el = (item as { $el?: unknown } | null)?.$el;
  if (el instanceof HTMLElement) candidateItems.set(name, el);
  else candidateItems.delete(name);
}
function openService(service: string) {
  emit("close");
  void router.push({
    name: "traces",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      tab: "services-catalog",
      panel: "versions",
      panelSvc: service,
      panelWhere: service === props.scope?.service ? props.scope.where_key : undefined,
    },
  });
}
</script>
