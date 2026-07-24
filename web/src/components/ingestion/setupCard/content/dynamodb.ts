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

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { applySubs, applySubsMasked } from "../subs";

// The HTTP-endpoint destination values for the Kinesis Firehose delivery stream.
const FIREHOSE = `HTTP endpoint URL: {url}/aws/{org}/dynamodb/_kinesis_firehose
Access key: Basic {token}`;

export default function dynamodbCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "DynamoDB",
      tagline: "Stream DynamoDB item changes into OpenObserve via Kinesis Firehose.",
      logo: getImageURL("images/ingestion/dynamodb.png"),
      tone: "#4053D6",
      metaBadges: ["Logs"],
    },
    steps: [
      {
        id: "firehose-endpoint",
        title: "OpenObserve Firehose Endpoint",
        description:
          "Use these as the **HTTP Endpoint** destination when creating your Kinesis Data Firehose delivery stream.",
        chip: { kind: "editor", label: "firehose" },
        completeOn: "copy",
        code: {
          lang: "text",
          raw: applySubs(FIREHOSE, subs),
          masked: applySubsMasked(FIREHOSE, subs),
        },
      },
      {
        id: "pipeline",
        title: "Stream DynamoDB → Firehose",
        description:
          "Enable **DynamoDB Streams** on your table, connect it to a **Kinesis Data Stream**, then point a **Kinesis Data Firehose** delivery stream at the HTTP endpoint above.",
        chip: { kind: "editor", label: "AWS Console" },
        completeOn: "copy",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or open Logs for the `dynamodb` stream once items change.",
        chip: { kind: "traces", label: "Logs" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Item Changes", "Inserts", "Updates", "Deletes"],
      },
    ],
    detect: { streamType: "logs", match: "keyword", streamName: "dynamodb", filter: "" },
    docUrl: "https://openobserve.ai/blog/how-to-monitor-dynamodb-table",
  };
}
