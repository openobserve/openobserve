<template>
  <div class="flex flex-col gap-3" :data-test="testId">
    <div
      v-if="identity || where"
      class="flex flex-wrap items-center gap-2"
      data-test="svcver-no-version-header"
    >
      <span class="text-text-heading text-base font-semibold whitespace-nowrap">{{ service }}</span>
      <ServiceEnvChip v-if="identity" :identity="identity" :service="service" />
      <ServiceScopeChip v-if="where" facet="where" :where-key="where" :value="whereLabel" />
    </div>
    <OEmptyState
      size="compact"
      :title="
        service
          ? t('serviceVersions.setup.titleFor', { service })
          : t('serviceVersions.setup.title')
      "
      :description="t('serviceVersions.setup.intro')"
    >
      <template #illustration>
        <span
          class="bg-tabs-active-bg text-tabs-active-text rounded-surface flex size-12 items-center justify-center"
          ><OIcon name="flag" size="md"
        /></span>
      </template>
      <template #extra>
        <div class="flex w-full max-w-208 flex-col items-center gap-3">
          <div class="flex w-full flex-wrap gap-3 text-start">
            <div
              v-for="kind in ['otel', 'sdk'] as const"
              :key="kind"
              class="flex min-w-64 flex-1 flex-col gap-2"
            >
              <div class="flex items-center gap-2">
                <OTag
                  :variant="kind === 'otel' ? 'teal-soft' : 'cyan-soft'"
                  :icon="kind === 'otel' ? 'account-tree' : 'devices'"
                  :label="
                    kind === 'otel'
                      ? t('serviceVersions.compare.traces')
                      : t('serviceVersions.compare.rum')
                  "
                />
                <span class="text-text-heading text-xs font-semibold">{{
                  kind === "otel"
                    ? t("serviceVersions.setup.otelTitle")
                    : t("serviceVersions.setup.sdkTitle")
                }}</span>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="content-copy"
                  class="ms-auto"
                  :aria-label="t('serviceVersions.actions.copySnippet')"
                  :data-test="`svcver-copy-${kind}`"
                  @click="copy(kind)"
                />
              </div>
              <pre
                class="bg-surface-panel border-border-default rounded-default border p-3 font-mono text-xs whitespace-pre-wrap"
                >{{ shown[kind] }}</pre>
              <i18n-t
                v-if="kind === 'otel'"
                keypath="serviceVersions.setup.hint"
                tag="span"
                scope="global"
                class="text-text-secondary text-xs"
              >
                <template #sha
                  ><span class="font-mono">{{ sha }}</span></template
                >
              </i18n-t>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <OButton
              variant="outline"
              size="sm"
              data-test="svcver-setup-guide"
              @click="openGuide"
              >{{ t("serviceVersions.setup.guide") }}</OButton
            >
            <OButton
              variant="ghost-primary"
              size="sm"
              icon-left="content-copy"
              data-test="svcver-copy-snippet"
              @click="copy('otel')"
              >{{ t("serviceVersions.actions.copySnippet") }}</OButton
            >
          </div>
        </div>
      </template>
    </OEmptyState>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { Environment } from "@/services/service_versions";
const props = withDefaults(
  defineProps<{
    service?: string;
    env?: string;
    testId?: string;
    identity?: Environment;
    where?: string;
    whereLabel?: string;
  }>(),
  {
    service: "",
    env: "",
    testId: "svcver-no-version",
    identity: undefined,
    where: "",
    whereLabel: "",
  },
);
const { t } = useI18nTyped();
const guide = "https://openobserve.ai/docs/ingestion/traces/opentelemetry/";
const sha = "${GIT_SHA}";
const otel = ["service.version=${RELEASE_VERSION}", "deployment.environment.name=${ENV}"];
const sdk = computed(() => [
  `service: ${JSON.stringify(props.service || "your-service")}`,
  `env: ${props.env ? JSON.stringify(props.env) : "import.meta.env.VITE_APP_ENV"}`,
  "version: import.meta.env.VITE_APP_VERSION",
]);
const snippets = computed(() => ({
  otel: `OTEL_RESOURCE_ATTRIBUTES=${otel.join(",")}`,
  sdk: `openobserveRum.init({ ${sdk.value.join(", ")} })`,
}));
const shown = computed(() => ({
  otel: `OTEL_RESOURCE_ATTRIBUTES=\n  ${otel.join(",\n  ")}`,
  sdk: `openobserveRum.init({\n  ${sdk.value.join(",\n  ")},\n})`,
}));
function openGuide() {
  window.open(guide, "_blank", "noopener");
}
function copy(kind: "otel" | "sdk") {
  void copyToClipboard(snippets.value[kind], t, {
    successMessage: t("serviceVersions.rum.noVersion.copied"),
  });
}
</script>
