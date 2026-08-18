// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Google Cloud setup card. Unlike the agent cards, nothing is installed: GCP
// pushes to an OpenObserve HTTP endpoint via a Pub/Sub push subscription, so the
// card's job is to hand over the right URL and show where it goes in the GCP
// console.
//
// The stream is a `streamInput`, so the name the user picks flows into BOTH the
// push endpoint URL and the live detection — the page can't end up watching a
// different stream than the one GCP is writing to.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { applySubs, applySubsMasked } from "../subs";

// {stream} is filled live by the renderer from the stream-name field.
const PUSH_ENDPOINT = "{url}/gcp/{org}/{stream}/_sub?API-Key={token}";

export default function gcpCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("Google Cloud"),
      tagline: t("ingestion.setupCard.taglineGcp"),
      logo: getImageURL("images/ingestion/gcp.svg"),
      tone: "#4285f4",
      runtime: raw("Google Cloud"),
      setupTime: t("ingestion.setupCard.setupTime5Min"),
      metaBadges: [t("common.logs")],
    },
    steps: [
      {
        id: "sink",
        titleKey: "ingestion.setupCard.gcpSinkTitle",
        descriptionKey: "ingestion.setupCard.gcpSinkDesc",
        chip: { kind: "editor", label: raw("GCP Console") },
        required: true,
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: `# Or from the CLI — create the topic, then the sink that feeds it
gcloud pubsub topics create openobserve-logs

gcloud logging sinks create openobserve-sink \\
  pubsub.googleapis.com/projects/$(gcloud config get-value project)/topics/openobserve-logs \\
  --log-filter='severity >= "DEFAULT"'`,
        },
        note: t("ingestion.setupCard.gcpSinkWriterNote"),
      },
      {
        id: "subscription",
        titleKey: "ingestion.setupCard.gcpSubscriptionTitle",
        descriptionKey: "ingestion.setupCard.gcpSubscriptionDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.endpointLabel" },
        required: true,
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: applySubs(PUSH_ENDPOINT, subs),
          masked: applySubsMasked(PUSH_ENDPOINT, subs),
        },
        note: t("ingestion.setupCard.gcpPushUrlNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyGcpLogsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipLogs" },
        completeOn: "detect",
        detectionAnchor: true,
        // Everything after the first pill is a Google Cloud product name.
        pills: [
          t("ingestion.setupCard.pillAuditLogs"),
          raw("Cloud Run"),
          raw("GKE"),
          raw("Cloud Functions"),
          raw("VPC Flow"),
        ],
      },
    ],
    streamInput: {
      labelKey: "ingestion.setupCard.logsStreamNameLabel",
      default: "default",
      placeholder: raw("gcp_logs"),
      helpKey: "ingestion.setupCard.gcpStreamHelp",
    },
    // The push subscription writes to exactly this stream, so any row on it in
    // the lookback window is proof the pipeline works end to end.
    detect: {
      streamType: "logs",
      streamName: "default",
      filter: "_timestamp IS NOT NULL",
    },
    extras: {
      fixTitle: t("ingestion.setupCard.gcpFixTitle"),
      fixBody: t("ingestion.setupCard.gcpFixBody"),
      fixLang: "bash",
      fixSnippet: `gcloud pubsub subscriptions describe openobserve-push \\
  --format='value(pushConfig.pushEndpoint)'

# Unacked messages piling up means the endpoint is erroring
gcloud pubsub subscriptions describe openobserve-push \\
  --format='value(numUndeliveredMessages)'`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.gcpTroubleDeliveryQ"),
          a: t("ingestion.setupCard.gcpTroubleDeliveryA"),
        },
        {
          q: t("ingestion.setupCard.gcpTroubleTopicQ"),
          a: t("ingestion.setupCard.gcpTroubleTopicA"),
        },
        {
          q: t("ingestion.setupCard.gcpTroublePartialQ"),
          a: t("ingestion.setupCard.gcpTroublePartialA"),
        },
        {
          q: t("ingestion.setupCard.gcpTroubleWorkspaceQ"),
          a: t("ingestion.setupCard.gcpTroubleWorkspaceA"),
        },
      ],
    },
    docUrl: "https://openobserve.ai/blog/send-gcp-logs-to-openobserve",
    // Both guides the page linked before the migration. Google Workspace is a
    // distinct source that rides the same Pub/Sub pipeline, so it belongs here
    // as a first-class link, not as prose.
    docLinks: [
      {
        label: raw("Google Workspace"),
        url: "https://short.openobserve.ai/security/google-workspace",
      },
    ],
  };
}
