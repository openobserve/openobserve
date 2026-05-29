<template>
  <div class="tw:p-3">
    <ContentCopy :content="getCommand"></ContentCopy>
    <br />
    <hr />
    <div>
      <div class="tw:text-base tw:font-medium tw:pl-1 tw:mt-3">
        Once you have installed the OpenObserve collector, it will:
        <ol class="tw:list-decimal tw:ml-5">
          <li>Collect system logs</li>
          <li>Collect host metrics</li>
        </ol>
      </div>
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
    `${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`,
  );
});

const getCommand = computed(() => {
  return `curl -O https://raw.githubusercontent.com/openobserve/agents/main/linux/install.sh && chmod +x install.sh && sudo ./install.sh ${endpoint.value.url}/api/${props.currOrgIdentifier}/ [BASIC_PASSCODE]`;
});
</script>

<style scoped></style>
