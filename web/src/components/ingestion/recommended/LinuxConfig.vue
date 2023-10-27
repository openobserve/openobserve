<template>
  <div class="q-pa-md">
    <ContentCopy :content="getCommand"></ContentCopy>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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

const endpoint: Ref<Endpoint> = ref({
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

const getCommand = computed(() => {
  return `wget https://raw.githubusercontent.com/openobserve/agents/main/linux/install.sh \      
    && chmod +x install.sh && sudo ./install.sh ${endpoint.value.url}/api/${props.currOrgIdentifier}/ ${accessKey.value}`;
});
</script>

<style scoped></style>
