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

// Databricks data-source setup card. Follows the OpenObserve guide:
// https://openobserve.ai/blog/monitor-databricks/ — Databricks ships LOGS by
// POSTing them from a notebook to OpenObserve's logs API (no OTel collector).

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import { applySubs, applySubsMasked } from "../subs";

const NOTEBOOK_PY = `import requests

url = "{url}/api/{org}/databricks_logs/_json"
headers = {
    "Authorization": "Basic {token}",
    "Content-Type": "application/json",
}

# POST your records as a JSON array
records = [{"source": "databricks", "message": "hello from databricks"}]
requests.post(url, headers=headers, json=records)`;

export default function databricksCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "Databricks",
      tagline: "Ship Databricks notebook logs to OpenObserve over the logs API.",
      logo: getImageURL("images/ingestion/databricks.svg"),
      tone: "#FF3621",
      metaBadges: ["Logs"],
    },
    steps: [
      {
        id: "notebook",
        title: "Send Logs From Your Notebook",
        description:
          "Paste into a Databricks notebook cell — it POSTs records to OpenObserve's logs API.",
        chip: { kind: "editor", label: "notebook.py" },
        completeOn: "copy",
        code: {
          lang: "python",
          filename: "notebook.py",
          raw: applySubs(NOTEBOOK_PY, subs),
          masked: applySubsMasked(NOTEBOOK_PY, subs),
        },
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description: "Hit Test below, or open Logs and search `source:databricks`.",
        chip: { kind: "traces", label: "Logs" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["databricks_logs"],
      },
    ],
    detect: { streamType: "logs", match: "keyword", streamName: "databricks", filter: "" },
    docUrl: "https://openobserve.ai/blog/monitor-databricks/",
  };
}
