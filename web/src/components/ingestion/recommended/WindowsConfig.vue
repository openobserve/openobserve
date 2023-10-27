<template>
  <div class="q-pa-md">
    <div class="text-subtitle2 q-pb-sm">
      You need minimum PowerShell 6 to run the install script. you can check
      your PowerShell version by running
      <code
        class="q-px-xs q-py-xs text-subtitle2"
        style="border-radius: 4px"
        >$PSVersionTable.PSVersion</code
      >
      in your terminal.
    </div>
    <div>You should see something like this:</div>
    <pre
      class="notranslate q-px-md q-py-md text-body"
    >PS C:\<span class="pl-k">&gt;</span> <span class="pl-c1">$PSVersionTable<span class="pl-smi">.PSVersion</span></span>

Major  Minor  Patch  PreReleaseLabel BuildLabel
<span class="pl-k">-----</span>  <span class="pl-k">-----</span>  <span class="pl-k">-----</span>  <span class="pl-k">---------------</span> <span class="pl-k">----------</span>
<span class="pl-c1">7</span>      <span class="pl-c1">3</span>      <span class="pl-c1">7</span>
</pre>
    <div class="text-subtitle2">Major should be at least 6.</div>
    <div class="text-subtitle2 q-pt-sm">
      You can download and install the latest version of powershell from
      <a
        target="_blank"
        href="https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.3"
        >here</a
      >
    </div>

    <div class="text-subtitle1 q-pl-xs q-mt-md">From powershell terminal:</div>
    <ContentCopy class="q-mt-sm" :content="getCommand" />
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

const getCommand = computed(() => {
  return `Invoke-WebRequest -Uri https://raw.githubusercontent.com/openobserve/agents/main/windows/install.ps1 -OutFile install.ps1 ; .\install.ps1 -URL ${endpoint.value.url}/api/${props.currOrgIdentifier}/ -AUTH_KEY ${accessKey.value}`;
});
</script>

<style scoped></style>
