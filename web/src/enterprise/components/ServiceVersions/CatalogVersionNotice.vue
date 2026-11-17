<template>
  <div class="flex h-8 min-w-8 shrink-0 items-center" data-test="svcver-notice-slot">
    <span
      v-if="failure"
      role="alert"
      class="border-banner-error-soft-border bg-status-error-bg text-status-error-text rounded-default inline-flex h-7 items-center gap-1 border ps-2 pe-0.5 text-xs font-medium whitespace-nowrap"
      :data-test="failure.test"
    >
      <OIcon :name="failure.icon" size="xs" class="shrink-0" />
      <span tabindex="0" :aria-label="failure.message"
        >{{ failure.label }}<OTooltip :content="failure.message"
      /></span>
      <OButton
        v-if="failure.retry"
        variant="ghost"
        size="xs"
        data-test="svcver-retry"
        @click="$emit('refresh')"
        >{{ t("serviceVersions.actions.retry") }}</OButton
      >
    </span>
    <OPopover v-else-if="info" align="start" :aria-label="info.message">
      <template #trigger>
        <OButton variant="ghost" size="icon-sm" :aria-label="info.message" :data-test="info.test">
          <OIcon name="info" size="sm" class="text-text-secondary" />
        </OButton>
      </template>
      <div class="text-text-body flex max-w-80 flex-col items-start gap-2 px-3 py-2.5 text-xs">
        <span>{{ info.message }}</span>
        <OButton
          v-if="info.action"
          variant="ghost-primary"
          size="xs"
          :data-test="info.action.test"
          @click="info.action.run"
          >{{ info.action.label }}</OButton
        >
      </div>
    </OPopover>
  </div>
  <ODialog v-model:open="setupOpen" size="lg" :title="t('serviceVersions.setup.dialogTitle')">
    <NoVersionState :env="env" test-id="svcver-no-version-setup" />
  </ODialog>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { Scope, ServicesResponse } from "@/services/service_versions";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import NoVersionState from "./NoVersionState.vue";
import { catalogSummary } from "@/plugins/traces/servicesCatalogVersions";
import { noVerdictText } from "@/utils/serviceVersionsCopy";
const props = defineProps<{
  data?: ServicesResponse;
  scopes?: Scope[];
  state: "loading" | "locked" | "error" | "ready";
  env: string;
  verdict: string;
}>();
const emit = defineEmits<{ verdict: [string]; refresh: [] }>();
const { t } = useI18nTyped();
const setupOpen = ref(false);
const unavailable = computed(() => props.data?.verdict_status === "unavailable");
const summary = computed(() => catalogSummary(props.data, props.env, props.scopes));
const failure = computed(() => {
  if (props.state === "locked")
    return {
      test: "svcver-catalog-denied",
      icon: "lock",
      label: t("serviceVersions.catalog.deniedShort"),
      message: t("serviceVersions.compare.denied"),
      retry: false,
    };
  const versionsDown = props.state === "error";
  if (!versionsDown && !(props.state === "ready" && unavailable.value)) return null;
  return {
    test: "svcver-catalog-error",
    icon: "error",
    label: t(
      versionsDown
        ? "serviceVersions.catalog.versionsUnavailableShort"
        : "serviceVersions.catalog.verdictsUnavailableShort",
    ),
    message: versionsDown
      ? t("serviceVersions.catalog.versionsUnavailable", {
          title: t("serviceVersions.catalog.versionsUnavailableTitle"),
        })
      : t("serviceVersions.catalog.verdictsUnavailable", {
          title: t("serviceVersions.catalog.verdictsUnavailableTitle"),
        }),
    retry: true,
  };
});
const info = computed(() => {
  if (props.state !== "ready" || unavailable.value) return null;
  const { noVersion, total, launchDay, preTracking } = summary.value;
  if (props.data?.services.length && launchDay)
    return {
      test: "svcver-launch-day",
      message: noVerdictText(props.data.tracking, t, undefined, preTracking ? false : undefined),
    };
  if (props.verdict === "no_version")
    return {
      test: "svcver-no-version",
      message: t(
        "serviceVersions.catalog.noVersionHint",
        {
          count: t("serviceVersions.catalog.noVersionHintCount", { count: noVersion, total }),
          scope: props.env,
          attribute: "service.version",
        },
        noVersion,
      ),
      action: {
        test: "svcver-how-to-version",
        label: t("serviceVersions.catalog.howToAddVersion"),
        run: () => (setupOpen.value = true),
      },
    };
  if (!noVersion) return null;
  return {
    test: "svcver-no-version-band",
    message: t(
      "serviceVersions.catalog.noVersionBand",
      { count: t("serviceVersions.catalog.noVersionBandCount", { count: noVersion }, noVersion) },
      noVersion,
    ),
    action: {
      test: "svcver-show-no-version",
      label: t("serviceVersions.actions.showThem", {}, noVersion),
      run: () => emit("verdict", "no_version"),
    },
  };
});
</script>
