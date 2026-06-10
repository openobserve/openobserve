<template>
  <IngestionContent>
    <div class="tw:flex tw:flex-col tw:gap-2">
      <div class="tw:text-base tw:font-semibold" data-test="ingestion-otelconfig-otlp-http-title">OTLP HTTP</div>
      <ContentCopy class="copy-content-container-cls" :content="getOtelHttpConfig" data-test="ingestion-otelconfig-copy-http" />
    </div>
    <div class="tw:flex tw:flex-col tw:gap-2" v-if="config.isCloud == 'false'">
      <div class="tw:text-base tw:font-semibold" data-test="ingestion-otelconfig-otlp-grpc-title">OTLP gRPC</div>
      <ContentCopy class="copy-content-container-cls" :content="getOtelGrpcConfig" data-test="ingestion-otelconfig-copy-grpc" />
    </div>
  </IngestionContent>
</template>

<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import type { Endpoint } from "@/ts/interfaces";
import ContentCopy from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import { useStore } from "vuex";
import { b64EncodeStandard, getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import config from "@/aws-exports";

const store = useStore();

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

const accessKey = computed(() => {
  return b64EncodeStandard(
    `${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`
  );
});

const getOtelGrpcConfig = computed(() => {
  return `exporters:
  otlp/openobserve:
      endpoint: ${endpoint.value.host}:5081
      headers:
        Authorization: "Basic ${accessKey.value}"
        organization: ${props.currOrgIdentifier}
        stream-name: default
      tls:
        insecure: true

service:
  telemetry:
    logs:
      level: warn`;
});

const getOtelHttpConfig = computed(() => {
  return `exporters:
  otlphttp/openobserve:
    endpoint: ${endpoint.value.url}/api/${props.currOrgIdentifier}
    headers:
      Authorization: Basic ${accessKey.value}
      stream-name: default

service:
  telemetry:
    logs:
      level: warn`;
});

defineExpose({
  endpoint,
  ingestionURL,
  accessKey,
  getOtelGrpcConfig,
  getOtelHttpConfig
});
</script>

<style scoped></style>
