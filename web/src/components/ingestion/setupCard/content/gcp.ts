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

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { applySubs, applySubsMasked } from "../subs";

// {stream} is filled live by the renderer from the stream-name field.
const PUSH_ENDPOINT = "{url}/gcp/{org}/{stream}/_sub?API-Key={token}";

export default function gcpCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Google Cloud",
      tagline:
        "Stream Google Cloud logs into OpenObserve with a Pub/Sub push subscription — no agent or collector to run.",
      logo: getImageURL("images/ingestion/gcp.svg"),
      tone: "#4285f4",
      runtime: "Google Cloud",
      setupTime: "~5 min",
      metaBadges: ["Logs"],
    },
    steps: [
      {
        id: "sink",
        title: "Route Logs to a Pub/Sub Topic",
        description:
          "In the GCP console, create a **Log Router sink** (Logging → Log Router → Create sink) with Pub/Sub as the destination, and let it create the topic. The sink's inclusion filter decides which logs reach OpenObserve.",
        chip: { kind: "editor", label: "GCP Console" },
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
        note: "Grant the sink's writer identity the Pub/Sub Publisher role on the topic, or it will silently publish nothing.",
      },
      {
        id: "subscription",
        title: "Push the Topic to OpenObserve",
        description:
          "Create a **push** subscription on that topic and paste this as the endpoint URL. It already carries this organization and its ingestion key.",
        chip: { kind: "terminal", label: "Endpoint" },
        required: true,
        completeOn: "copy",
        code: {
          lang: "bash",
          raw: applySubs(PUSH_ENDPOINT, subs),
          masked: applySubsMasked(PUSH_ENDPOINT, subs),
        },
        note: "Keep this URL secret — it embeds the ingestion key. Rotate it from this page's header if it leaks.",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Generate some activity in the project (or wait for the sink to match a log), then hit Test.",
        chip: { kind: "traces", label: "Logs" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Audit Logs", "Cloud Run", "GKE", "Cloud Functions", "VPC Flow"],
      },
    ],
    streamInput: {
      label: "Logs Stream Name",
      default: "default",
      placeholder: "gcp_logs",
      help: "Used in the push URL above and watched by the check below. A dedicated stream keeps GCP logs separate.",
    },
    // The push subscription writes to exactly this stream, so any row on it in
    // the lookback window is proof the pipeline works end to end.
    detect: {
      streamType: "logs",
      streamName: "default",
      filter: "_timestamp IS NOT NULL",
    },
    extras: {
      fixTitle: "Check The Push Subscription",
      fixBody:
        "GCP reports delivery failures on the subscription itself. If the sink is publishing but nothing lands here, the push endpoint is usually rejecting the request:",
      fixLang: "bash",
      fixSnippet: `gcloud pubsub subscriptions describe openobserve-push \\
  --format='value(pushConfig.pushEndpoint)'

# Unacked messages piling up means the endpoint is erroring
gcloud pubsub subscriptions describe openobserve-push \\
  --format='value(numUndeliveredMessages)'`,
      troubleshooting: [
        {
          q: "The subscription shows delivery errors",
          a: "A 401 means the `API-Key` in the URL is stale — re-copy the endpoint from this page. A 404 usually means the org or stream segment was edited by hand; the URL above is already correct for this organization.",
        },
        {
          q: "The sink exists but the topic receives nothing",
          a: "The sink's **writer identity** needs the Pub/Sub Publisher role on the topic. GCP creates the sink successfully without it and then drops everything, silently.",
        },
        {
          q: "Only some logs arrive",
          a: "That is the sink's inclusion filter, not OpenObserve. Widen the `--log-filter` on the sink to cover the services and severities you expect.",
        },
        {
          q: "Can I send Google Workspace audit logs too?",
          a: "Yes — Workspace exports into Cloud Logging, so the same Log Router sink picks it up once the export is enabled. Open the **Google Workspace** guide linked at the bottom of this page for the export setup.",
        },
      ],
    },
    docUrl: "https://openobserve.ai/blog/send-gcp-logs-to-openobserve",
    // Both guides the page linked before the migration. Google Workspace is a
    // distinct source that rides the same Pub/Sub pipeline, so it belongs here
    // as a first-class link, not as prose.
    docLinks: [
      {
        label: "Google Workspace",
        url: "https://short.openobserve.ai/security/google-workspace",
      },
    ],
  };
}
