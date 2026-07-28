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

<!--
  HTTP setup page for the incident ingest webhook.

  Follows the sibling data-source pages (see metrics/VMagentConfig.vue) —
  IngestionContent wrapper, one CopyContent per snippet, IngestionDocLink in the
  footer. CopyContent substitutes [EMAIL]/[PASSCODE] and masks the passcode
  until revealed, so the snippets are copy-paste ready.
-->
<template>
  <IngestionContent>
    <div class="text-secondary">
      {{ t("ingestion.alertsWebhookIntro") }}
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">
        {{ t("ingestion.alertsWebhookFiringTitle") }}
      </div>
      <CopyContent data-test="ingestion-alerts-webhook-firing" :content="firingContent" />
      <div class="text-secondary">
        {{ t("ingestion.alertsWebhookLabelsNote") }}
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">
        {{ t("ingestion.alertsWebhookResolveTitle") }}
      </div>
      <CopyContent data-test="ingestion-alerts-webhook-resolve" :content="resolveContent" />
      <div class="text-secondary">
        {{ t("ingestion.alertsWebhookResolveNote") }}
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-base font-semibold">
        {{ t("ingestion.alertsWebhookAlertmanagerTitle") }}
      </div>
      <CopyContent
        data-test="ingestion-alerts-webhook-alertmanager"
        :content="alertmanagerContent"
      />
      <div class="text-secondary">
        {{ t("ingestion.alertsWebhookAlertmanagerNote") }}
      </div>
    </div>

    <IngestionDocLink
      href="https://openobserve.ai/docs/user-guide/alerts/incident-webhook/"
      data-test="ingestion-alerts-webhook-doclink"
    >
      {{ t("ingestion.alertsWebhookDocLink") }}
    </IngestionDocLink>
  </IngestionContent>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getEndPoint, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";

export default defineComponent({
  name: "IncidentWebhook",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CopyContent, IngestionContent, IngestionDocLink },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const endpoint: any = ref({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);

    const org = store.state.selectedOrganization.identifier;
    const ingestUrl = `${endpoint.value.url}/api/v2/${org}/alerts/incidents/ingest`;

    const firingContent = `curl -u [EMAIL]:[PASSCODE] -k ${ingestUrl} \\
  -H 'Content-Type: application/json' \\
  -d '{
    "source": "alertmanager",
    "alert_name": "HighErrorRate",
    "dedup_key": "a1b2c3",
    "severity": "critical",
    "status": "firing",
    "labels": {
      "service": "checkout",
      "k8s_namespace_name": "production",
      "host": "ip-10-0-1-5"
    },
    "annotations": {
      "summary": "Error rate above 5% for 10 minutes"
    },
    "external_url": "https://alertmanager.example.com/#/alerts"
  }'`;

    const resolveContent = `curl -u [EMAIL]:[PASSCODE] -k ${ingestUrl} \\
  -H 'Content-Type: application/json' \\
  -d '{
    "source": "alertmanager",
    "alert_name": "HighErrorRate",
    "status": "resolved"
  }'`;

    // Alertmanager posts its own fixed payload shape, which this endpoint does
    // not accept — so the realistic wiring is a small transform in front of it,
    // not a bare webhook_configs block. Showing the transform is honest; showing
    // webhook_configs alone would look correct and silently 400.
    const alertmanagerContent = `# Alertmanager posts its own payload shape, so map it first.
# Point a webhook_config at this relay instead of at OpenObserve directly.

jq -c '.alerts[] | {
  source:      "alertmanager",
  alert_name:  .labels.alertname,
  dedup_key:   .fingerprint,
  severity:    .labels.severity,
  status:      .status,
  labels:      .labels,
  annotations: .annotations,
  external_url: .generatorURL
}' \\
  | while read -r alert; do
      curl -u [EMAIL]:[PASSCODE] -k ${ingestUrl} \\
        -H 'Content-Type: application/json' -d "$alert"
    done`;

    return {
      t,
      store,
      endpoint,
      firingContent,
      resolveContent,
      alertmanagerContent,
    };
  },
});
</script>
