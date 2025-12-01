<template>
  <div>
    <div class="q-pa-sm">
      <div class="text-subtitle1 text-bold">OTLP HTTP</div>
      <ContentCopy class="q-mt-sm" :content="getOtelHttpConfig" />
    </div>
    <div class="q-pa-md">
      <div class="text-subtitle1 text-bold">OTLP gRPC</div>
      <ContentCopy :content="getOtelGrpcConfig" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import type { Endpoint } from "@/ts/interfaces";
import ContentCopy from "@/components/CopyContent.vue";
import { useStore } from "vuex";
import { b64EncodeStandard, getEndPoint, getIngestionURL } from "../../../utils/zincutils";

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
        Authorization: "Basic [BASIC_PASSCODE]"
        organization: ${props.currOrgIdentifier}
        stream-name: default
      tls:
        insecure: true`;
});

const getOtelHttpConfig = computed(() => {
  return `exporters:
  otlphttp/openobserve:
    endpoint: ${endpoint.value.url}/api/${props.currOrgIdentifier}
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default`;
});
</script>

<style scoped></style>
