<template>
  <IngestionContent>
    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">OTLP HTTP</div>
      <ContentCopy :content="getOtelHttpConfig" />
    </div>
    <div class="flex flex-col gap-2" v-if="config.isCloud == 'false'">
      <div class="text-base font-semibold">OTLP gRPC</div>
      <ContentCopy :content="getOtelGrpcConfig" />
    </div>
  </IngestionContent>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ContentCopy from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import config from "@/aws-exports";

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

const getOtelGrpcConfig = computed(() => {
  return `exporters:
  otlp/openobserve:
      endpoint: ${endpoint.value.host}:5081
      headers:
        Authorization: "Basic [BASIC_PASSCODE]"
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
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default

service:
  telemetry:
    logs:
      level: warn`;
});
</script>
