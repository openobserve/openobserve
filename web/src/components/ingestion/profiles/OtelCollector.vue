<template>
  <IngestionContent>
    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">{{ t("ingestion.otlpHttp") }}</div>
      <CredentialCodeBlock slug="profiles-otel" :content="getProfilesConfig" />
    </div>
  </IngestionContent>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

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

const getProfilesConfig = computed(() => {
  return `exporters:
  otlphttp/openobserve_profiles:
    endpoint: ${endpoint.value.url}
    profiles_endpoint: ${endpoint.value.url}/api/${props.currOrgIdentifier}/v1/profiles
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default

service:
  telemetry:
    logs:
      level: warn`;
});
</script>
