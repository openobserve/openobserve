<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <IngestionContent snippet-kind="config" copy-snippet="first" config-tool="Datadog Agent">
    <OText variant="body" as="p" data-test="ingestion-datadogagent-intro">
      {{ t("ingestion.datadogAgent.intro", { product }) }}
    </OText>

    <section class="flex flex-col gap-2" data-test="ingestion-datadogagent-env">
      <OText variant="body-strong" as="h3">{{ t("ingestion.datadogAgent.envTitle") }}</OText>
      <OText variant="body" as="p">
        {{ t("ingestion.datadogAgent.envBody", { product, version: raw(MIN_AGENT_VERSION) }) }}
      </OText>
      <CredentialCodeBlock
        v-if="!passcodeIsNotOrgToken"
        slug="datadogagent-env"
        lang="bash"
        :content="envContent"
      />
      <OText variant="meta" as="p" data-test="ingestion-datadogagent-features-off-note">
        {{
          t("ingestion.datadogAgent.featuresOffBody", {
            vendor: raw("Datadog"),
            component: raw("agent-data-plane"),
            setting: raw("DD_DATA_PLANE_ENABLED=false"),
          })
        }}
      </OText>
      <OText variant="meta" as="p" data-test="ingestion-datadogagent-profiling-note">
        {{ t("ingestion.datadogAgent.profilingBody") }}
      </OText>
      <OBanner
        v-if="passcodeIsNotOrgToken"
        variant="warning"
        icon="warning"
        data-test="ingestion-datadogagent-token-note"
      >
        <div class="flex flex-col gap-1">
          <OText variant="meta" as="p" class="leading-snug">
            {{ t("ingestion.datadogAgent.tokenBody", { prefix: raw(ORG_TOKEN_PREFIX) }) }}
          </OText>
          <router-link
            :to="ingestionTokensRoute"
            class="text-text-link hover:text-text-link-hover font-medium underline"
            data-test="ingestion-datadogagent-tokens-link"
          >
            {{ t("ingestion.datadogAgent.tokenLink") }}
          </router-link>
        </div>
      </OBanner>
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-datadogagent-logs">
      <OText variant="body-strong" as="h3">{{ t("ingestion.datadogAgent.logsTitle") }}</OText>
      <OText variant="body" as="p">
        {{
          t("ingestion.datadogAgent.logsBody", { product, setting: raw("DD_LOGS_ENABLED=true") })
        }}
      </OText>
      <OText variant="meta" as="p" data-test="ingestion-datadogagent-correlation-note">
        {{
          t("ingestion.datadogAgent.correlationBody", {
            setting: raw("DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true"),
          })
        }}
      </OText>
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-datadogagent-dual">
      <OText variant="body-strong" as="h3">{{ t("ingestion.datadogAgent.dualTitle") }}</OText>
      <OText variant="body" as="p">
        {{
          t("ingestion.datadogAgent.dualBody", {
            file: raw("datadog.yaml"),
            setting: raw("force_use_http: true"),
          })
        }}
      </OText>
      <CredentialCodeBlock
        v-if="!passcodeIsNotOrgToken"
        slug="datadogagent-dual"
        lang="yaml"
        :content="dualContent"
      />
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-datadogagent-metrics">
      <OText variant="body-strong" as="h3">{{ t("ingestion.datadogAgent.metricsTitle") }}</OText>
      <ul class="m-0 flex list-disc flex-col gap-1 ps-5">
        <li>
          {{
            t("ingestion.datadogAgent.metricsTypes", {
              typeField: raw("datadog_metric_type"),
              intervalField: raw("datadog_interval"),
            })
          }}
        </li>
        <li>
          {{
            t("ingestion.datadogAgent.metricsCount", {
              promql: raw("sum_over_time()"),
              sql: raw("sum()"),
            })
          }}
        </li>
        <li>
          {{ t("ingestion.datadogAgent.metricsRate", { intervalField: raw("datadog_interval") }) }}
        </li>
        <li>
          {{
            t("ingestion.datadogAgent.metricsCounterFns", {
              rate: raw("rate()"),
              increase: raw("increase()"),
            })
          }}
        </li>
        <li>{{ t("ingestion.datadogAgent.metricsSketch") }}</li>
        <li>{{ t("ingestion.datadogAgent.multiValueTagsBody") }}</li>
      </ul>
    </section>
  </IngestionContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { getEndPoint } from "../../../utils/zincutils";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";

defineProps<{ currOrgIdentifier?: string; currUserEmail?: string }>();

const MIN_AGENT_VERSION = "7.70.0";
const ORG_TOKEN_PREFIX = "o2oi_";

// These features ignore the URLs above and send to Datadog-owned hosts with the same API key.
const DATADOG_ONLY_FEATURES_OFF = [
  "DD_INVENTORIES_DIAGNOSTICS_ENABLED=false",
  "DD_REMOTE_CONFIGURATION_ENABLED=false",
  "DD_DISCOVERY_ENABLED=false",
  "DD_PROCESS_CONFIG_CONTAINER_COLLECTION_ENABLED=false",
  "DD_PROCESS_CONFIG_PROCESS_DISCOVERY_ENABLED=false",
  "DD_CONTAINER_LIFECYCLE_ENABLED=false",
  "DD_CONTAINER_IMAGE_ENABLED=false",
  "DD_ORCHESTRATOR_EXPLORER_ENABLED=false",
  "DD_AGENT_TELEMETRY_ENABLED=false",
  "DD_APM_TELEMETRY_ENABLED=false",
  "DD_DATA_PLANE_ENABLED=false",
];

const { t } = useI18nTyped();
const store = useStore();
const product = raw("Datadog Agent");

// Reads what getIngestionURL reads, reactively, since `/config` can supply ingestion_url after mount.
const ingestionUrl = computed<string>(
  () => store.state.zoConfig?.ingestion_url || store.state.API_ENDPOINT,
);
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// The Agent concatenates request paths onto this URL, so a trailing slash yields `//api/...`.
const datadogUrl = computed(() => {
  const base = new URL(getEndPoint(ingestionUrl.value).url, window.location.origin).href;
  return `${base.replace(/\/+$/, "")}/datadog/${org.value}`;
});

const envContent = computed(
  () => `DD_API_KEY=[PASSCODE]
DD_DD_URL=${datadogUrl.value}
DD_APM_DD_URL=${datadogUrl.value}
DD_LOGS_CONFIG_LOGS_DD_URL=${datadogUrl.value}
${DATADOG_ONLY_FEATURES_OFF.join("\n")}`,
);

// Additional log endpoints take host, port and path separately rather than a URL.
const logsEndpoint = computed(() => {
  const url = new URL(datadogUrl.value, window.location.origin);
  const useSsl = url.protocol === "https:";
  return {
    host: url.hostname,
    port: url.port || (useSsl ? "443" : "80"),
    useSsl,
    pathPrefix: url.pathname,
  };
});

const dualContent = computed(
  () => `data_plane:
  enabled: false
additional_endpoints:
  "${datadogUrl.value}": ["[PASSCODE]"]
apm_config:
  additional_endpoints:
    "${datadogUrl.value}": ["[PASSCODE]"]
logs_config:
  force_use_http: true
  additional_endpoints:
    - host: ${JSON.stringify(logsEndpoint.value.host)}
      port: ${logsEndpoint.value.port}
      use_ssl: ${logsEndpoint.value.useSsl}
      path_prefix: ${logsEndpoint.value.pathPrefix}
      api_key: [PASSCODE]`,
);

// With no org token the key would be the user passcode, which the Datadog intake rejects.
const passcodeIsNotOrgToken = computed(() => {
  const passcode: string = store.state.organizationData?.organizationPasscode ?? "";
  return !!passcode && !passcode.startsWith(ORG_TOKEN_PREFIX);
});

const ingestionTokensRoute = computed(() => ({
  name: "ingestionTokens",
  query: { org_identifier: org.value },
}));
</script>
