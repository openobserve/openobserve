<template>
  <div>
    <div class="p-2 pt-1">
      <div class="text-base font-bold font-medium">{{ t("ingestion.otlpHttp") }}</div>
      <ContentCopy class="mt-2" :content="raw(getOtelHttpConfig)" />
    </div>
    <div class="p-3" v-if="showOtlpGrpc">
      <div class="text-base font-bold font-medium">{{ t("ingestion.otlpGrpc") }}</div>
      <ContentCopy :content="raw(getOtelGrpcConfig)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ContentCopy from "@/components/CopyContent.vue";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import { raw, useI18nTyped } from "@/types/i18n";
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
</script>
