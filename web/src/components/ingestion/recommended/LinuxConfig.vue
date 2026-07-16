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
        <OIcon :name="opt.icon" size="lg" :class="selected === opt.value ? 'text-[var(--color-theme-accent)]' : 'text-icon-color'" />
        <div>
          <div class="font-semibold text-sm">{{ opt.label }}</div>
          <div class="text-xs mt-0.5 text-text-secondary">{{ opt.description }}</div>
        </div>
      </div>
    </div>

    <!-- EC2 IAM prerequisite note -->
    <div
      v-if="selected === 'ec2'"
      class="flex gap-2 items-start rounded-lg p-3 mb-4 text-sm bg-banner-warning-bg border border-banner-warning-border"
    >
      <OIcon name="info" size="sm" class="text-banner-warning-text shrink-0 mt-0.5" />
      <div class="text-banner-warning-text">
        <span class="font-semibold">IAM role required.</span>
        Attach an IAM role to your EC2 instance with
        <code class="font-mono text-xs">ec2:DescribeTags</code> and
        <code class="font-mono text-xs">ec2:DescribeInstances</code>
        permissions. This allows the collector to read the instance Name tag and use it as the host identifier.
      </div>
    </div>

    <!-- Install command -->
    <ContentCopy :content="activeCommand" :key="selected" />

    <OSeparator class="my-4" />

    <!-- What it collects -->
    <div class="text-sm font-medium pl-1">
      Once installed, the collector will:
      <ul class="list-disc ml-5 mt-1 font-normal space-y-0.5">
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

const selectedCardClass = "border-[var(--color-theme-accent)] bg-status-info-bg";

const unselectedCardClass =
  "border-border-default bg-surface-base hover:border-border-strong";
</script>
