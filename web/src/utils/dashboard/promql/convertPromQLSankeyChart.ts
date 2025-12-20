// Copyright 2023 Zinc Labs Inc.
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

import { PromQLChartConverter, ProcessedPromQLData, SankeyConfig } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";

/**
 * Converter for Sankey diagram charts
 * Requires metrics with source and target labels for flow visualization
 */
export class SankeyConverter implements PromQLChartConverter {
  supportedTypes = ["sankey"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any
  ) {
    const config: SankeyConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "sum";

    // Get label names for source and target
    const sourceLabel = config.source_label || "source";
    const targetLabel = config.target_label || "target";

    const nodes = new Set<string>();
    const links: any[] = [];
    const errors: string[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const source = seriesData.metric[sourceLabel];
        const target = seriesData.metric[targetLabel];

        if (!source || !target) {
          errors.push(
            `Series "${seriesData.name}" missing flow labels. ` +
              `Expected labels: "${sourceLabel}", "${targetLabel}"`
          );
          return;
        }

        nodes.add(source);
        nodes.add(target);

        const value = applyAggregation(seriesData.values, aggregation);

        links.push({
          source,
          target,
          value,
        });
      });
    });

    if (errors.length > 0) {
      console.warn("Sankey conversion warnings:", errors);
    }

    if (links.length === 0) {
      console.error(
        `Sankey chart error: No valid flow data found. ` +
        `Ensure your PromQL query returns metrics with "${sourceLabel}" and "${targetLabel}" labels.\n` +
        `Example query: sum by (source_service, target_service) (requests_total)`
      );

      // Return empty chart with error message
      return {
        series: [],
        title: {
          text: `No Sankey data found`,
          subtext: `Metrics must have "${sourceLabel}" and "${targetLabel}" labels`,
          left: 'center',
          top: 'center',
          textStyle: {
            fontSize: 16,
            color: '#999'
          },
          subtextStyle: {
            fontSize: 12,
            color: '#666'
          }
        }
      };
    }

    const nodeData = Array.from(nodes).map((name) => ({ name }));

    return {
      series: [
        {
          type: "sankey",
          data: nodeData,
          links,
          emphasis: {
            focus: "adjacency",
          },
          lineStyle: {
            color: config.link_color || "gradient",
            curveness: config.curveness || 0.5,
          },
          label: {
            show: config.show_label !== false,
            position: config.label_position || "right",
            fontSize: config.label_font_size || 12,
          },
          orient: config.orient || "horizontal",
          layoutIterations: config.layout_iterations || 32,
        },
      ],
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        formatter: (params: any) => {
          if (params.dataType === "edge") {
            return `${params.data.source} → ${params.data.target}<br/>Value: ${params.data.value}`;
          } else {
            return `${params.name}`;
          }
        },
      },
    };
  }
}
