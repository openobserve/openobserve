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

// DynamoDB data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/how-to-monitor-dynamodb-table — DynamoDB item
// changes flow DynamoDB Streams → Kinesis Data Stream → Kinesis Firehose → the
// OpenObserve Firehose endpoint (an AWS-console flow; no OTel collector).

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { applySubs, applySubsMasked } from "../subs";

// The HTTP-endpoint destination values for the Kinesis Firehose delivery stream.
const FIREHOSE = `HTTP endpoint URL: {url}/aws/{org}/dynamodb/_kinesis_firehose
Access key: Basic {token}`;

export default function dynamodbCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("DynamoDB"),
      tagline: t("ingestion.setupCard.dynamodbTagline"),
      logo: getImageURL("images/ingestion/dynamodb.png"),
      tone: "#4053D6",
      metaBadges: [t("common.logs")],
    },
    steps: [
      {
        id: "firehose-endpoint",
        titleKey: "ingestion.setupCard.dynamodbFirehoseEndpointTitle",
        descriptionKey: "ingestion.setupCard.dynamodbFirehoseEndpointDesc",
        chip: { kind: "editor", label: raw("firehose") },
        completeOn: "copy",
        code: {
          lang: "text",
          raw: applySubs(FIREHOSE, subs),
          masked: applySubsMasked(FIREHOSE, subs),
        },
      },
      {
        id: "pipeline",
        titleKey: "ingestion.setupCard.dynamodbPipelineTitle",
        descriptionKey: "ingestion.setupCard.dynamodbPipelineDesc",
        chip: { kind: "editor", label: raw("AWS Console") },
        completeOn: "copy",
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyDynamodbLogsDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipLogs" },
        completeOn: "detect",
        detectionAnchor: true,
        // What the verify step will show, in prose. These are NOT the `eventName` values
        // in the ingested stream (those are INSERT / MODIFY / REMOVE) — they are a
        // plain-English summary of them, so they are translated.
        pills: [
          t("ingestion.setupCard.pillItemChanges"),
          t("ingestion.setupCard.pillInserts"),
          t("ingestion.setupCard.pillUpdates"),
          t("ingestion.setupCard.pillDeletes"),
        ],
      },
    ],
    detect: { streamType: "logs", match: "keyword", streamName: "dynamodb", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-dynamodb-table",
  };
}
