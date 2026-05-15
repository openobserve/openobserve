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

import { json2csv } from "json-2-csv";
import { useQuasar } from "quasar";

const downloadLogs = async (
  data: Record<string, any>[],
  format: "csv" | "json",
) => {
  const $q = useQuasar();

  if (!data || data.length === 0) {
    $q.notify({
      message: "No data found to download.",
      color: "positive",
      position: "bottom",
      timeout: 2000,
    });
    return;
  }

  try {
    let filename = "logs-data";
    let dataobj: string | Blob;

    if (format === "csv") {
      filename += ".csv";
      dataobj = await json2csv(data, { emptyFieldValue: "" });
      dataobj = new Blob([dataobj], { type: "text/csv" });
    } else {
      filename += ".json";
      dataobj = JSON.stringify(data, null, 2);
      dataobj = new Blob([dataobj], { type: "application/json" });
    }

    const file = new File([dataobj], filename, {
      type: format === "csv" ? "text/csv" : "application/json",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Error downloading logs",
      timeout: 2000,
    });
  }
};

export default downloadLogs;
