<template>
  <div>
    <div class="p-2 pt-1">
      <div class="text-base font-medium font-bold">{{ t('ingestion.otlpHttp') }}</div>
      <ContentCopy class="mt-2" :content="getOtelHttpConfig" />
    </div>
    <div class="p-3" v-if="config.isCloud == 'false'">
      <div class="text-base font-medium font-bold">{{ t('ingestion.otlpGrpc') }}</div>
      <ContentCopy :content="getOtelGrpcConfig" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ContentCopy from "@/components/CopyContent.vue";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import config from "@/aws-exports";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
