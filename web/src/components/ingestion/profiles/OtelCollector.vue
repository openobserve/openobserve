<template>
  <IngestionContent>
    <!-- Same configs as the profiles docs (OTLP page), so the snippet runs on its own. -->
    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t("ingestion.otlpHttp") }}</div>
      <CredentialCodeBlock slug="profiles-otel" :content="httpConfig" />
      <div class="text-text-secondary text-xs">
        {{ t("ingestion.profilesServiceNameNote", { attr: raw("service.name") }) }}
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t("ingestion.profilesStartCollector") }}</div>
      <CredentialCodeBlock slug="profiles-otel-start" :content="startCommand" />
      <div class="text-text-secondary text-xs">
        {{ t("ingestion.profilesAlphaNote", { version: raw("otelcol-contrib 0.153.0") }) }}
      </div>
    </div>
    <div v-if="showOtlpGrpc" class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t("ingestion.otlpGrpc") }}</div>
      <CredentialCodeBlock slug="profiles-otel-grpc" :content="grpcConfig" />
    </div>
    <IngestionDocLink href="https://openobserve.ai/docs/ingestion/profiles/">
      {{ t("ingestion.profilesDocLinkText") }}
    </IngestionDocLink>
  </IngestionContent>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import { raw, useI18nTyped } from "@/types/i18n";
import useOtlpGrpcVisibility from "@/composables/useOtlpGrpcVisibility";

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

const endpoint = ref({
  url: "",
  host: "",
  port: "",
  protocol: "",
  tls: "",
});

const ingestionURL = getIngestionURL();
endpoint.value = getEndPoint(ingestionURL);

// The resource processor names one application, as in the docs; the note under the block says when to drop it.
const pipeline = (exporter: string) => `processors:
  resource:
    attributes:
      - key: service.name
        value: your-service
        action: upsert

service:
  pipelines:
    profiles:
      receivers: [otlp]
      processors: [resource]
      exporters: [${exporter}]`;

const httpConfig = computed(
  () => `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlp_http/openobserve:
    endpoint: ${endpoint.value.url}
    profiles_endpoint: ${endpoint.value.url}/api/${props.currOrgIdentifier}/v1/profiles
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default

${pipeline("otlp_http/openobserve")}`,
);

const startCommand =
  "otelcol-contrib --feature-gates=+service.profilesSupport --config=otelcol-config.yaml";

// gRPC carries the organization in a header; the cloud gateway uses TLS on 443, a self-hosted server 5081.
const grpcConfig = computed(() => {
  const target = isPrimaryCloud.value
    ? { endpoint: "grpc.openobserve.ai:443", insecure: false }
    : { endpoint: `${endpoint.value.host}:5081`, insecure: true };
  return `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

exporters:
  otlp_grpc/openobserve:
    endpoint: ${target.endpoint}
    headers:
      Authorization: "Basic [BASIC_PASSCODE]"
      organization: ${props.currOrgIdentifier}
      stream-name: default
    tls:
      insecure: ${target.insecure}

${pipeline("otlp_grpc/openobserve")}`;
});
</script>
