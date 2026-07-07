<template>
  <div class="p-3">
    <!-- Environment selection cards -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <div
        v-for="opt in options"
        :key="opt.value"
        class="rounded-lg border p-4 cursor-pointer transition-all flex gap-3 items-start"
        :class="selected === opt.value ? selectedCardClass : unselectedCardClass"
        @click="selected = opt.value"
      >
        <OIcon :name="opt.icon" size="lg" :class="selected === opt.value ? 'text-[var(--q-primary)]' : 'text-gray-400'" />
        <div>
          <div class="font-semibold text-sm">{{ opt.label }}</div>
          <div class="text-xs mt-0.5" :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'">{{ opt.description }}</div>
        </div>
      </div>
    </div>

    <!-- EC2 IAM prerequisite note -->
    <div
      v-if="selected === 'ec2'"
      class="flex gap-2 items-start rounded-lg p-3 mb-4 text-sm"
      :class="store.state.theme === 'dark' ? 'bg-amber-950/40 border border-amber-800/50' : 'bg-amber-50 border border-amber-200'"
    >
      <OIcon name="info" size="sm" class="text-amber-500 shrink-0 mt-0.5" />
      <div :class="store.state.theme === 'dark' ? 'text-amber-200' : 'text-amber-900'">
        <span class="font-semibold">IAM role required.</span>
        Attach an IAM role to your EC2 instance with
        <code class="font-mono text-xs">ec2:DescribeTags</code> and
        <code class="font-mono text-xs">ec2:DescribeInstances</code>
        permissions. This allows the collector to read the instance Name tag and use it as the host identifier.
      </div>
    </div>

    <!-- Admin note -->
    <div class="text-sm font-medium mb-2">
      Run the following command in PowerShell as Administrator:
    </div>

    <!-- Install command -->
    <ContentCopy :content="activeCommand" :key="selected" />

    <OSeparator class="my-4" />

    <!-- What it collects -->
    <div class="text-sm font-medium pl-1">
      Once installed, the collector will:
      <ul class="list-disc ml-5 mt-1 font-normal space-y-0.5">
        <li>Collect Windows Event Log (Application, Security, Setup, System)</li>
        <li>Collect host metrics (CPU, memory, disk, network)</li>
        <li>Collect Windows performance counter metrics</li>
        <li v-if="selected === 'ec2'">Detect EC2 instance metadata automatically</li>
        <li v-if="selected === 'ec2'">Use the EC2 Name tag as the host identifier in dashboards</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ContentCopy from "@/components/CopyContent.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { useStore } from "vuex";
import { b64EncodeStandard, getEndPoint, getIngestionURL } from "../../../utils/zincutils";

const store = useStore();

const props = defineProps({
  currOrgIdentifier: { type: String },
  currUserEmail: { type: String },
});

const selected = ref("generic");

const options = [
  {
    value: "generic",
    label: "Generic Windows",
    description: "Any Windows server or VM",
    icon: "desktop_windows",
  },
  {
    value: "ec2",
    label: "AWS EC2",
    description: "EC2 instances with Name tag detection",
    icon: "cloud",
  },
];

const endpoint: any = ref({ url: "", host: "", port: "", protocol: "", tls: "" });
const ingestionURL = getIngestionURL();
endpoint.value = getEndPoint(ingestionURL);

const accessKey = computed(() =>
  b64EncodeStandard(`${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`)
);

const activeCommand = computed(() => {
  const script = selected.value === "ec2"
    ? "https://raw.githubusercontent.com/openobserve/agents/main/windows/ec2/install.ps1"
    : "https://raw.githubusercontent.com/openobserve/agents/main/windows/install.ps1";
  return `Invoke-WebRequest -Uri ${script} -OutFile install.ps1 ; .\\install.ps1 -URL ${endpoint.value.url}/api/${props.currOrgIdentifier}/ -AUTH_KEY [BASIC_PASSCODE]`;
});

const selectedCardClass = computed(() =>
  store.state.theme === "dark"
    ? "border-[var(--q-primary)] bg-blue-950/30"
    : "border-[var(--q-primary)] bg-blue-50"
);

const unselectedCardClass = computed(() =>
  store.state.theme === "dark"
    ? "border-gray-700 bg-gray-800/40 hover:border-gray-500"
    : "border-gray-200 bg-white hover:border-gray-300"
);
</script>
