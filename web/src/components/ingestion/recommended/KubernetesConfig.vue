<!-- eslint-disable no-useless-escape -->
<template>
  <div class="q-pa-md kubernetes-config-section tw:pb-lg">
    <!-- Quick Install Section -->
    <div class="tw:mb-6 tw:p-4 tw:rounded-lg" :class="quickInstallBgClass">
      <div class="tw:flex tw:items-start tw:gap-3">
        <OIcon name="rocket-launch" size="md" />
        <div class="tw:flex-1">
          <h6 class="tw:text-base tw:font-bold tw:m-0 tw:mb-2">Quick Install (Recommended)</h6>
          <p class="tw:text-sm tw:m-0 tw:mb-3" :class="descriptionClass">
            Install OpenObserve collector with a single command. Just set your cluster name and run.
          </p>

          <div class="tw:mb-3">
            <q-input
              v-model="clusterName"
              label="Cluster Name"
              placeholder="e.g., production, staging, dev"
              filled
              dense
              class="tw:max-w-md"
              data-test="kubernetes-cluster-name-input"
            >
              <template #prepend>
                <OIcon name="dns" size="sm" />
              </template>
            </q-input>
          </div>

          <div v-if="config.isCloud != 'true'" class="tw:mb-3">
            <OTabs v-model="installType" dense>
              <OTab name="external" label="External Endpoint" />
              <OTab name="internal" label="Internal Endpoint">
                <q-tooltip>Use this if OpenObserve is in the same cluster</q-tooltip>
              </OTab>
            </OTabs>
          </div>

          <ContentCopy class="tw:mt-3" :content="quickInstallCmd" :key="`${clusterName}-${installType}`" />

          <div class="tw:mt-2 tw:text-xs" :class="hintClass">
            <OIcon name="info" size="xs" class="tw:mr-1" />
            This installs cert-manager, OpenTelemetry operator, and OpenObserve collector automatically
          </div>
        </div>
      </div>
    </div>

    <q-separator class="tw:mb-6" />

    <!-- Advanced/Manual Install Section -->
    <q-expansion-item
      v-model="showAdvancedInstall"
      label="Advanced Installation (Manual Steps)"
      caption="For custom configurations or step-by-step installation"
      header-class="text-primary"
      data-test="kubernetes-advanced-install-toggle"
    >
      <div class="tw:mt-4">
        <div class="text-subtitle1 q-pl-xs q-mt-md">Install cert-manager</div>
        <ContentCopy
          class="q-mt-sm"
          content="kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.19.0/cert-manager.yaml"
        />

        <div class="text-subtitle1 q-pl-xs q-mt-md">
          Wait for 2 minutes after installing cert-manger for the webhook to be
          ready.
        </div>

        <div class="text-subtitle1 q-pl-xs q-mt-md">Update helm repo</div>
        <ContentCopy class="q-mt-sm" :content="helmUpdateCmd" />

        <div class="text-subtitle1 q-pl-xs q-mt-md">
          Install Prometheus operator CRDs(Required by Opentelemetry operator)
        </div>
        <ContentCopy class="q-mt-sm" :content="crdCommand" />

        <div class="text-subtitle1 q-pl-xs q:mt-md">
          Install OpenTelemetry operator
        </div>
        <ContentCopy
          class="q-mt-sm"
          content="kubectl apply -f https://raw.githubusercontent.com/openobserve/openobserve-helm-chart/refs/heads/main/opentelemetry-operator.yaml"
        />

        <div class="text-subtitle1 q-pl-xs q-mt-md">Create namespace</div>
        <ContentCopy
          class="q-mt-sm"
          content="kubectl create ns openobserve-collector"
        />

        <div class="text-subtitle1 q-pl-xs q-mt-md">
          Install OpenObserve collector
        </div>
        <div v-if="config.isCloud == 'true'">
          <ContentCopy class="q-mt-sm" :content="collectorCmd" />
        </div>
        <div v-else>
          <OTabs v-model="tab" horizontalalign="left">
            <OTab
              data-test="kubernetes-default-tab"
              name="external"
              :label="t('ingestion.external')"
            />
            <OTab
              data-test="kubernetes-this-tab"
              name="internal"
              :label="t('ingestion.internal')"
            >
              <q-tooltip>
                {{ t("ingestion.internalLabel") }}
              </q-tooltip>
            </OTab>
          </OTabs>
          <q-separator />
          <OTabPanels
            v-model="tab"
            animated
            swipeable
            vertical
            transition-prev="jump-up"
            transition-next="jump-up"
          >
            <OTabPanel name="internal" data-test="kubernetes-tab-panels-this">
              <ContentCopy class="q-mt-sm" :content="collectorCmdThisCluster" />
              <pre>
Format of the URL is: http://&lt;helm-release-name&gt;-openobserve-router.&lt;namespace&gt;.svc.cluster.local
Make changes accordingly to the above URL.
              </pre>
            </OTabPanel>

            <OTabPanel name="external" data-test="kubernetes-tab-panels-default">
              <ContentCopy class="q-mt-sm" :content="collectorCmd" />
            </OTabPanel>
          </OTabPanels>
        </div>
      </div>
    </q-expansion-item>

    <br />
    <hr />
    <div class="text-subtitle1 q-pl-xs q-mt-md q-mb-lg">
      Once you have installed the OpenObserve collector, it will:
      <ul class="tw:list-disc tw:ml-5">
        <li>Collect metrics from your Kubernetes cluster</li>
        <li>Collect events from your Kubernetes cluster</li>
        <li>Collect logs from your Kubernetes cluster</li>
        <li>
          Allow you to capture traces without instrumenting your applications
          that are written in following languages using OpenTelemetry
          auto-instrumentation. It can be done by setting the following to the
          pod/namespace annotations:
          <ul class="tw:list-disc tw:ml-5">
            <li>
              <b>Java:</b> instrumentation.opentelemetry.io/inject-java:
              "openobserve-collector/openobserve-java"
            </li>
            <li>
              <b>DotNet:</b> instrumentation.opentelemetry.io/inject-dotnet:
              "openobserve-collector/openobserve-dotnet"
            </li>
            <li>
              <b>NodeJS:</b> instrumentation.opentelemetry.io/inject-nodejs:
              "openobserve-collector/openobserve-nodejs"
            </li>
            <li>
              <b>Python:</b> instrumentation.opentelemetry.io/inject-python:
              "openobserve-collector/openobserve-python"
            </li>
            <li>
              <b>Go (Uses eBPF):</b>
              <ul class="tw:list-disc tw:ml-5">
                <li>
                  instrumentation.opentelemetry.io/inject-go:
                  "openobserve-collector/openobserve-go"
                </li>
                <li>
                  instrumentation.opentelemetry.io/otel-go-auto-target-exe:
                  "/path/to/container/executable"
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
      You can refer and install
      <a
        href="https://github.com/openobserve/hotcommerce"
        class="hover:tw:underline text-primary"
        >HOT commerce</a
      >
      app as an example to understand how this works in practice. Refer to
      <a
        href="https://github.com/open-telemetry/opentelemetry-operator"
        class="hover:tw:underline text-primary"
        >OpenTelemetry operator</a
      >
      for further documentation.
    </div>
  </div>
</template>

<script setup lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import { computed, ref, type Ref } from "vue";
import type { Endpoint } from "@/ts/interfaces";
import ContentCopy from "@/components/CopyContent.vue";
import { useStore } from "vuex";
import { b64EncodeStandard, getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import config from "@/aws-exports";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
const tab = ref("external");
const installType = ref("external");
const clusterName = ref("cluster1");
const showAdvancedInstall = ref(false);
const { t } = useI18n();

endpoint.value = getEndPoint(ingestionURL);

const accessKey = computed(() => {
  return b64EncodeStandard(
    `${props.currUserEmail}:${store.state.organizationData.organizationPasscode}`,
  );
});

// Computed class for styling based on theme
const quickInstallBgClass = computed(() => {
  return store.state.theme === 'dark'
    ? 'tw:bg-gray-800 tw:border tw:border-gray-700'
    : 'tw:bg-blue-50 tw:border tw:border-blue-200';
});

const descriptionClass = computed(() => {
  return store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700';
});

const hintClass = computed(() => {
  return store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600';
});

// Quick install command
const quickInstallCmd = computed(() => {
  const baseCmd = 'curl -sSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/k8s/install.sh | bash -s --';

  if (config.isCloud === 'true') {
    // Cloud version - external endpoint only
    return `${baseCmd} \\
  --cluster-name=${clusterName.value} \\
  --o2-url=${endpoint.value.url} \\
  --org-id=${props.currOrgIdentifier} \\
  --access-key=${accessKey.value}`;
  } else {
    // Self-hosted version - support both internal and external
    if (installType.value === 'internal') {
      return `${baseCmd} \\
  --cluster-name=${clusterName.value} \\
  --org-id=${props.currOrgIdentifier} \\
  --access-key=${accessKey.value} \\
  --internal-endpoint=http://o2-openobserve-router.openobserve.svc.cluster.local:5080`;
    } else {
      return `${baseCmd} \\
  --cluster-name=${clusterName.value} \\
  --o2-url=${endpoint.value.url} \\
  --org-id=${props.currOrgIdentifier} \\
  --access-key=${accessKey.value}`;
    }
  }
});

const collectorCmd = computed(() => {
  return `helm --namespace openobserve-collector \\
  upgrade --install o2c openobserve/openobserve-collector \\
  --set k8sCluster=${clusterName.value}  \\
  --set exporters.'otlphttp/openobserve'.endpoint=${endpoint.value.url}/api/${props.currOrgIdentifier}  \\
  --set exporters.'otlphttp/openobserve'.headers.Authorization='Basic ${accessKey.value}'  \\
  --set exporters.'otlphttp/openobserve_k8s_events'.endpoint=${endpoint.value.url}/api/${props.currOrgIdentifier}  \\
  --set exporters.'otlphttp/openobserve_k8s_events'.headers.Authorization='Basic ${accessKey.value}'`;
});

const collectorCmdThisCluster = computed(() => {
  return `helm --namespace openobserve-collector \\
  upgrade --install o2c openobserve/openobserve-collector \\
  --set k8sCluster=${clusterName.value}  \\
  --set exporters.'otlphttp/openobserve'.endpoint=http://o2-openobserve-router.openobserve.svc.cluster.local:5080/api/${props.currOrgIdentifier}  \\
  --set exporters.'otlphttp/openobserve'.headers.Authorization='Basic ${accessKey.value}'  \\
  --set exporters.'otlphttp/openobserve_k8s_events'.endpoint=http://o2-openobserve-router.openobserve.svc.cluster.local:5080/api/${props.currOrgIdentifier}  \\
  --set exporters.'otlphttp/openobserve_k8s_events'.headers.Authorization='Basic ${accessKey.value}'`;
});

const crdCommand = computed(() => {
  // Club kubectl create crd commands from template
  return `kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_servicemonitors.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/example/prometheus-operator-crd/monitoring.coreos.com_podmonitors.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/heads/main/example/prometheus-operator-crd/monitoring.coreos.com_scrapeconfigs.yaml
kubectl create -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/heads/main/example/prometheus-operator-crd/monitoring.coreos.com_probes.yaml`;
});

const helmUpdateCmd = computed(() => {
  return `helm repo add openobserve https://charts.openobserve.ai
helm repo update`;
});
</script>

<style scoped lang="scss"></style>
