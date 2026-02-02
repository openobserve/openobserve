// Copyright 2023 OpenObserve Inc.
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

/**
 * Generates a legend name for a PromQL metric using a template.
 *
 * @param metric - The metric object containing label key-value pairs
 * @param label - The legend template (e.g., "{job} - {instance}"). If null/empty, returns JSON stringified metric.
 * @returns The legend name with placeholders replaced by actual values
 *
 * @example
 * getPromqlLegendName({ job: "api", instance: "server1" }, "{job} on {instance}")
 * // Returns: "api on server1"
 *
 * getPromqlLegendName({ job: "api" }, "")
 * // Returns: '{"job":"api"}'
 */
export const getPromqlLegendName = (metric: any, label: string): string => {
  if (label) {
    let template = label || "";
    const placeholders = template.match(/\{([^}]+)\}/g);

    // Iterate through each placeholder
    placeholders?.forEach(function (placeholder: any) {
      // Extract the key from the placeholder
      const key = placeholder.replace("{", "").replace("}", "");

      // Retrieve the corresponding value from the metric object
      const value = metric[key];

      // Replace the placeholder with the value in the template
      if (value) {
        template = template.replace(placeholder, value);
      }
    });
    return template;
  } else {
    return JSON.stringify(metric);
  }
};

/**
 * Determines the orientation of the legend based on the legend position.
 *
 * @param legendPosition - The desired position of the legend ("bottom" or "right")
 * @returns "horizontal" for bottom position, "vertical" for right position
 */
export const getLegendPosition = (legendPosition: string): string => {
  switch (legendPosition) {
    case "bottom":
      return "horizontal";
    case "right":
      return "vertical";
    default:
      return "horizontal";
  }
};
