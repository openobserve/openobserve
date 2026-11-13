<template>
  <div class="mb-2 flex min-h-11 items-center" data-test="svcver-notice-slot">
    <ErrorPanel
      v-if="state === 'error' || (state === 'ready' && unavailable)"
      class="w-full"
      data-test="svcver-catalog-error"
    >
      <i18n-t
        :keypath="
          state === 'error'
            ? 'serviceVersions.catalog.versionsUnavailable'
            : 'serviceVersions.catalog.verdictsUnavailable'
        "
        tag="span"
        scope="global"
      >
        <template #title
          ><b>{{
            t(
              state === "error"
                ? "serviceVersions.catalog.versionsUnavailableTitle"
                : "serviceVersions.catalog.verdictsUnavailableTitle",
            )
          }}</b></template
        >
      </i18n-t>
      <template #actions>
        <OButton variant="outline" size="xs" data-test="svcver-retry" @click="$emit('refresh')">{{
          t("serviceVersions.actions.retry")
        }}</OButton>
      </template>
    </ErrorPanel>
    <OSkeleton
      v-else-if="state === 'loading'"
      class="h-8 w-full"
      data-test="svcver-catalog-loading"
    />
    <InfoNotice
      v-else-if="state === 'locked'"
      icon="lock"
      class="w-full"
      data-test="svcver-catalog-denied"
      >{{ t("serviceVersions.compare.denied") }}</InfoNotice
    >
    <template v-else-if="state === 'ready' && !unavailable">
      <InfoNotice
        v-if="data?.services.length && summary.launchDay"
        class="w-full"
        data-test="svcver-launch-day"
        >{{
          noVerdictText(data?.tracking, t, undefined, summary.preTracking ? false : undefined)
        }}</InfoNotice
      >
      <InfoNotice v-else-if="verdict === 'no_version'" class="w-full" data-test="svcver-no-version">
        <i18n-t
          keypath="serviceVersions.catalog.noVersionHint"
          tag="span"
          scope="global"
          :plural="summary.noVersion"
        >
          <template #count
            ><b class="text-text-heading">{{
              t("serviceVersions.catalog.noVersionHintCount", {
                count: summary.noVersion,
                total: summary.total,
              })
            }}</b></template
          >
          <template #scope>{{ env }}</template>
          <template #attribute
            ><span class="font-mono">{{ raw("service.version") }}</span></template
          >
        </i18n-t>
        <template #actions
          ><OButton
            variant="ghost-primary"
            size="xs"
            data-test="svcver-how-to-version"
            @click="setupOpen = true"
            >{{ t("serviceVersions.catalog.howToAddVersion") }}</OButton
          ></template
        >
      </InfoNotice>
      <InfoNotice v-else-if="summary.noVersion" class="w-full" data-test="svcver-no-version-band">
        <i18n-t
          keypath="serviceVersions.catalog.noVersionBand"
          tag="span"
          scope="global"
          :plural="summary.noVersion"
        >
          <template #count
            ><b class="text-text-heading">{{
              t(
                "serviceVersions.catalog.noVersionBandCount",
                { count: summary.noVersion },
                summary.noVersion,
              )
            }}</b></template
          >
        </i18n-t>
        <template #actions
          ><OButton
            variant="ghost-primary"
            size="xs"
            data-test="svcver-show-no-version"
            @click="$emit('verdict', 'no_version')"
            >{{ t("serviceVersions.actions.showThem", {}, summary.noVersion) }}</OButton
          ></template
        >
      </InfoNotice>
    </template>
  </div>
  <ODialog v-model:open="setupOpen" size="lg" :title="t('serviceVersions.setup.dialogTitle')">
    <NoVersionState :env="env" test-id="svcver-no-version-setup" />
  </ODialog>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Scope, ServicesResponse } from "@/services/service_versions";
import ErrorPanel from "@/components/shared/ErrorPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import InfoNotice from "@/components/shared/InfoNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
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
defineEmits<{ verdict: [string]; refresh: [] }>();
const { t } = useI18nTyped();
const setupOpen = ref(false);
const unavailable = computed(() => props.data?.verdict_status === "unavailable");
const summary = computed(() => catalogSummary(props.data, props.env, props.scopes));
</script>
