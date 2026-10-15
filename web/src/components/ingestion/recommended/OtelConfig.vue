<template>
  <div ref="root">
    <div class="p-2 pt-1">
      <div class="text-base font-bold font-medium">{{ t("ingestion.otlpHttp") }}</div>
      <CredentialCodeBlock slug="otel-http" class="mt-2" :content="getOtelHttpConfig" />
    </div>
    <div class="p-3" v-if="showOtlpGrpc">
      <div class="text-base font-bold font-medium">{{ t("ingestion.otlpGrpc") }}</div>
      <CredentialCodeBlock slug="otel-grpc" :content="getOtelGrpcConfig" />
    </div>
    <FirstEventStatus
      v-if="org"
      ref="bar"
      :key="org"
      class="p-3"
      :org="org"
      signal="traces"
      snippet-kind="config"
      @copy-command="copyHttpConfig"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import { provideSnippetCopied } from "@/composables/firstEvent/firstEventCopied";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import { useI18nTyped } from "@/types/i18n";
import useOtlpGrpcVisibility from "@/composables/useOtlpGrpcVisibility";
import { getOtelCollectorGrpcYaml } from "@/utils/otelCollectorConfig";

const { t } = useI18nTyped();
const { isPrimaryCloud, showOtlpGrpc } = useOtlpGrpcVisibility();

const props = defineProps({
  currOrgIdentifier: {
    type: String,
  },
  currUserEmail: {
    type: String,
  },
});

const endpoint: any = ref({
  url: "",
  host: "",
  port: "",
  protocol: "",
  tls: "",
});

const ingestionURL = getIngestionURL();
endpoint.value = getEndPoint(ingestionURL);

const getOtelGrpcConfig = computed(() =>
  getOtelCollectorGrpcYaml({
    orgIdentifier: props.currOrgIdentifier,
    selfHostedHost: endpoint.value.host,
    isPrimaryCloud: isPrimaryCloud.value,
  }),
);

const getOtelHttpConfig = computed(() => {
  return `exporters:
  otlphttp/openobserve:
    endpoint: ${endpoint.value.url}/api/${props.currOrgIdentifier}
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default

service:
  telemetry:
    logs:
      level: warn`;
});

const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const root = ref<HTMLElement | null>(null);
const bar = ref<InstanceType<typeof FirstEventStatus> | null>(null);
provideSnippetCopied(bar);
// Re-copies through the HTTP block, so the clipboard, the toast and snippet_copied match a click on it.
const copyHttpConfig = () =>
  root.value
    ?.querySelector<HTMLElement>('[data-test="ingestion-otel-http-code-block-copy-btn"]')
    ?.click();
</script>
