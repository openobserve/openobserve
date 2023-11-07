<!-- eslint-disable no-useless-escape -->
<template>
  <div class="q-pa-md">
    <div class="text-subtitle1 q-pl-xs q-mt-md">Install cert-manager</div>
    <ContentCopy
      class="q-mt-sm"
      content="kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.1/cert-manager.yaml"
    />

    <div class="text-subtitle1 q-pl-xs q-mt-md">
      Wait for 2 minutes after installing cert-manger for the webhook to be ready before installing OpenTelemetry operator.
    </div>

    <div class="text-subtitle1 q-pl-xs q-mt-md">
      Install OpenTelemetry operator
    </div>
    <ContentCopy
      class="q-mt-sm"
      content="kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml"
    />

    <div class="text-subtitle1 q-pl-xs q-mt-md">Update helm repo</div>
    <ContentCopy
      class="q-mt-sm"
      content="helm repo add openobserve https://charts.openobserve.ai"
    />
    <ContentCopy class="q-mt-sm" content="helm repo update" />

    <div class="text-subtitle1 q-pl-xs q-mt-md">Create namespace</div>
    <ContentCopy
      class="q-mt-sm"
      content="kubectl create ns openobserve-collector"
    />

    <div class="text-subtitle1 q-pl-xs q-mt-md">
      Install openobserve collector
    </div>
    <ContentCopy class="q-mt-sm" :content="collectorCmd" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import type { Endpoint } from "@/ts/interfaces";
import ContentCopy from "@/components/CopyContent.vue";
import { useStore } from "vuex";
import { b64EncodeUnicode } from "../../../utils/zincutils";

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

const url = new URL(store.state.API_ENDPOINT);

endpoint.value = {
  url: store.state.API_ENDPOINT,
  host: url.hostname,
  port: url.port || (url.protocol === "https:" ? "443" : "80"),
  protocol: url.protocol.replace(":", ""),
  tls: url.protocol === "https:" ? "On" : "Off",
};

const accessKey = computed(() => {
  return b64EncodeUnicode(
    `${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`
  );
});

const collectorCmd = computed(() => {
  return `helm --namespace openobserve-collector \\
  install o1c openobserve/openobserve-collector \\
  --set exporters."otlphttp/openobserve".endpoint=${endpoint.value.url}/api/${props.currOrgIdentifier}/  \\    
  --set exporters."otlphttp/openobserve".headers.Authorization="Basic ${accessKey.value}"  \\
  --set exporters."otlphttp/openobserve_k8s_events".endpoint=${endpoint.value.url}/api/${props.currOrgIdentifier}/  \\
  --set exporters."otlphttp/openobserve_k8s_events".headers.Authorization="Basic ${accessKey.value}"`;
});
</script>

<style scoped></style>
