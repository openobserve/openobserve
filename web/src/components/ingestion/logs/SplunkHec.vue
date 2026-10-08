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

<!-- The collector path is fixed at the root with no org and no base_uri, so unlike every other ingestion page these snippets must not interpolate the org. -->
<template>
  <IngestionContent>
    <OText variant="body" as="p" data-test="ingestion-logs-splunkhec-intro">
      {{
        t("ingestion.splunkHec.intro", { brand: raw("OpenObserve"), product: raw("Splunk HEC") })
      }}
    </OText>

    <section class="flex flex-col gap-2" data-test="ingestion-logs-splunkhec-endpoint">
      <OText variant="body-strong" as="h3">{{ t("ingestion.splunkHec.endpointTitle") }}</OText>
      <OText variant="body" as="p">
        {{
          t("ingestion.splunkHec.endpointBody", {
            path: raw("/services/collector"),
            alias: raw("/services/collector/event"),
          })
        }}
      </OText>
      <CopyContent class="copy-content-container-cls" :content="raw(endpointUrl)" />
      <OText variant="meta" as="p" class="leading-snug">
        {{ t("ingestion.splunkHec.endpointNote", { setting: raw("ZO_BASE_URI") }) }}
      </OText>
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-logs-splunkhec-auth">
      <OText variant="body-strong" as="h3">{{ t("ingestion.splunkHec.authTitle") }}</OText>
      <OText variant="body" as="p">
        {{ t("ingestion.splunkHec.authBody", { header: authHeader, brand: raw("OpenObserve") }) }}
      </OText>
      <OText variant="body" as="p">
        {{ t("ingestion.splunkHec.tokenWhere") }}
        <router-link
          :to="ingestionTokensRoute"
          class="text-text-link hover:text-text-link-hover font-medium underline"
          data-test="ingestion-logs-splunkhec-tokens-link"
        >
          {{ t("ingestion.splunkHec.tokenPageName") }}
        </router-link>
        {{ t("ingestion.splunkHec.tokenWhereSuffix") }}
      </OText>
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-logs-splunkhec-example">
      <OText variant="body-strong" as="h3">{{ t("ingestion.splunkHec.exampleTitle") }}</OText>
      <CopyContent class="copy-content-container-cls" :content="raw(curlContent)" />
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-logs-splunkhec-payload">
      <OText variant="body-strong" as="h3">{{ t("ingestion.splunkHec.payloadTitle") }}</OText>
      <CopyContent class="copy-content-container-cls" :content="raw(payloadContent)" />
      <OText variant="body" as="p">
        {{
          t("ingestion.splunkHec.payloadIndex", {
            field: raw("index"),
            stream: raw("default"),
          })
        }}
      </OText>
      <OText variant="body" as="p">
        {{ t("ingestion.splunkHec.payloadTime", { field: raw("time") }) }}
      </OText>
      <OBanner variant="warning" icon="schedule" data-test="ingestion-logs-splunkhec-window-note">
        <div class="flex flex-col gap-1">
          <OText variant="body-strong">{{ t("ingestion.splunkHec.windowTitle") }}</OText>
          <OText variant="meta" as="p" class="leading-snug">
            {{
              t("ingestion.splunkHec.windowBody", {
                past: raw("ZO_INGEST_ALLOWED_UPTO"),
                future: raw("ZO_INGEST_ALLOWED_IN_FUTURE"),
              })
            }}
          </OText>
        </div>
      </OBanner>
      <OText variant="body" as="p">
        {{
          t("ingestion.splunkHec.payloadMetadata", {
            fields: raw("host, source, sourcetype"),
          })
        }}
      </OText>
    </section>

    <section class="flex flex-col gap-2" data-test="ingestion-logs-splunkhec-health">
      <OText variant="body-strong" as="h3">{{ t("ingestion.splunkHec.healthTitle") }}</OText>
      <OText variant="body" as="p">
        {{
          t("ingestion.splunkHec.healthBody", {
            response: raw('{"text":"HEC is healthy","code":17}'),
          })
        }}
      </OText>
      <CopyContent class="copy-content-container-cls" :content="raw(healthContent)" />
    </section>

    <OBanner
      variant="warning"
      icon="warning"
      data-test="ingestion-logs-splunkhec-edge-processor-note"
    >
      <div class="flex flex-col gap-1">
        <OText variant="body-strong">
          {{ t("ingestion.splunkHec.edgeTitle", { product: raw("Splunk Edge Processor") }) }}
        </OText>
        <OText variant="meta" as="p" class="leading-snug">
          {{ t("ingestion.splunkHec.edgeAck", { setting: raw("useACK") }) }}
        </OText>
        <OText variant="meta" as="p" class="leading-snug">
          {{
            t("ingestion.splunkHec.edgeToken", {
              product: raw("Edge Processor"),
              header: raw("Authorization"),
            })
          }}
        </OText>
      </div>
    </OBanner>

    <OBanner variant="warning" icon="lock" data-test="ingestion-logs-splunkhec-tls-note">
      <div class="flex flex-col gap-1">
        <OText variant="body-strong">{{ t("ingestion.splunkHec.tlsTitle") }}</OText>
        <OText variant="meta" as="p" class="leading-snug">
          {{
            t("ingestion.splunkHec.tlsBody", {
              brand: raw("OpenObserve"),
              setting: raw("ZO_HTTP_TLS_ENABLED"),
            })
          }}
        </OText>
      </div>
    </OBanner>
  </IngestionContent>
</template>

<script lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { getEndPoint, getImageURL, getIngestionURL } from "../../../utils/zincutils";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";

export default defineComponent({
  name: "SplunkHec",
  props: {
    currOrgIdentifier: {
      type: String,
    },
    currUserEmail: {
      type: String,
    },
  },
  components: { CopyContent, IngestionContent, OBanner, OText },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    // The collector is registered like every other route, so a ZO_BASE_URI
    // deployment serves it under that prefix too — resolve the configured
    // ingest host rather than the browser origin serving the UI.
    const collectorBase = getEndPoint(getIngestionURL()).url;

    const endpointUrl = `${collectorBase}/services/collector`;

    // Built here because the template compiler reads a literal `<token>` in an interpolation as markup.
    const authHeader = raw("Authorization: Splunk " + "<token>");

    // No literal `time`: a hardcoded epoch ages past ZO_INGEST_ALLOWED_UPTO and is
    // then discarded, which the collector still answers with code 0.
    const curlContent = `curl -k ${endpointUrl} \\
  -H "Authorization: Splunk [SPLUNK_HEC_TOKEN]" \\
  -d '{"event":{"level":"info","log":"test message for openobserve"},"index":"default"}'`;

    // `time` is documented by example here, so it stays — but read through a clock
    // that ticks, since a page held open past ZO_INGEST_ALLOWED_UPTO would otherwise
    // hand out an epoch that is silently discarded behind a code 0.
    const nowSeconds = ref((Date.now() / 1000).toFixed(3));
    const retickPayloadClock = () => {
      nowSeconds.value = (Date.now() / 1000).toFixed(3);
    };
    let payloadClock: ReturnType<typeof setInterval> | undefined;
    onMounted(() => {
      payloadClock = setInterval(retickPayloadClock, 60_000);
    });
    onBeforeUnmount(() => {
      clearInterval(payloadClock);
    });

    const payloadContent = computed(
      () => `{
  "event": { "level": "info", "log": "test message for openobserve" },
  "index": "application",
  "time": ${nowSeconds.value},
  "host": "web-01",
  "source": "/var/log/app.log",
  "sourcetype": "app:json"
}`,
    );

    const healthContent = `curl -k ${collectorBase}/services/collector/health`;

    // The tokens page is org-scoped, unlike the collector endpoint itself.
    const ingestionTokensRoute = computed(() => ({
      name: "ingestionTokens",
      query: { org_identifier: store.state.selectedOrganization?.identifier },
    }));

    return {
      t,
      raw,
      store,
      endpointUrl,
      authHeader,
      curlContent,
      payloadContent,
      healthContent,
      ingestionTokensRoute,
      getImageURL,
    };
  },
});
</script>
