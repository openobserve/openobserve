<template>
  <div class="tw:p-3">
    <!-- Environment selection cards -->
    <div class="tw:grid tw:grid-cols-2 tw:gap-3 tw:mb-5">
      <div
        v-for="opt in options"
        :key="opt.value"
        class="tw:rounded-lg tw:border tw:p-4 tw:cursor-pointer tw:transition-all tw:flex tw:gap-3 tw:items-start"
        :class="selected === opt.value ? selectedCardClass : unselectedCardClass"
        @click="selected = opt.value"
      >
        <OIcon :name="opt.icon" size="lg" :class="selected === opt.value ? 'tw:text-[var(--q-primary)]' : 'tw:text-gray-400'" />
        <div>
          <div class="tw:font-semibold tw:text-sm">{{ opt.label }}</div>
          <div class="tw:text-xs tw:mt-0.5" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'">{{ opt.description }}</div>
        </div>
      </div>
    </div>

    <!-- EC2 IAM prerequisite note -->
    <div
      v-if="selected === 'ec2'"
      class="tw:flex tw:gap-2 tw:items-start tw:rounded-lg tw:p-3 tw:mb-4 tw:text-sm"
      :class="store.state.theme === 'dark' ? 'tw:bg-amber-950/40 tw:border tw:border-amber-800/50' : 'tw:bg-amber-50 tw:border tw:border-amber-200'"
    >
      <OIcon name="info" size="sm" class="tw:text-amber-500 tw:shrink-0 tw:mt-0.5" />
      <div :class="store.state.theme === 'dark' ? 'tw:text-amber-200' : 'tw:text-amber-900'">
        <span class="tw:font-semibold">IAM role required.</span>
        Attach an IAM role to your EC2 instance with
        <code class="tw:font-mono tw:text-xs">ec2:DescribeTags</code> and
        <code class="tw:font-mono tw:text-xs">ec2:DescribeInstances</code>
        permissions. This allows the collector to read the instance Name tag and use it as the host identifier.
      </div>
    </div>

    <!-- Install command -->
    <ContentCopy :content="activeCommand" :key="selected" />

    <OSeparator class="tw:my-4" />

    <!-- What it collects -->
    <div class="tw:text-sm tw:font-medium tw:pl-1">
      Once installed, the collector will:
      <ul class="tw:list-disc tw:ml-5 tw:mt-1 tw:font-normal tw:space-y-0.5">
        <li>Collect system logs and journald logs</li>
        <li>Collect host metrics (CPU, memory, disk, network)</li>
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
    label: "Generic Linux",
    description: "Any Linux server or VM",
    icon: "terminal",
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
  const base = selected.value === "ec2"
    ? "https://raw.githubusercontent.com/openobserve/agents/main/linux/ec2/install.sh"
    : "https://raw.githubusercontent.com/openobserve/agents/main/linux/install.sh";
  return `curl -O ${base} && chmod +x install.sh && sudo ./install.sh ${endpoint.value.url}/api/${props.currOrgIdentifier}/ [BASIC_PASSCODE]`;
});

const selectedCardClass = computed(() =>
  store.state.theme === "dark"
    ? "tw:border-[var(--q-primary)] tw:bg-blue-950/30"
    : "tw:border-[var(--q-primary)] tw:bg-blue-50"
);

const unselectedCardClass = computed(() =>
  store.state.theme === "dark"
    ? "tw:border-gray-700 tw:bg-gray-800/40 hover:tw:border-gray-500"
    : "tw:border-gray-200 tw:bg-white hover:tw:border-gray-300"
);
</script>

<style scoped></style>
