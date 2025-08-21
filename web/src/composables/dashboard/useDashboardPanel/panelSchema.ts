// Utilities for deriving chart metadata from query result schema

export type ExtractedFields = {
  group_by: string[];
  projections: string[];
  timeseries_field: string | null;
};

// Decide an initial chart type based on the presence of a time series and number of group-bys
export const determineChartType = (extractedFields: ExtractedFields): string => {
  if (
    extractedFields.timeseries_field &&
    extractedFields.group_by.length <= 2
  ) {
    return "line";
  }
  return "table";
};

// Convert an extracted schema to axes fields according to chart type
export const convertSchemaToFields = (
  extractedFields: ExtractedFields,
  chartType: string,
): { x: string[]; y: string[]; breakdown: string[] } => {
  // For table charts, add all projections to x-axis since tables display all fields as columns
  if (chartType === "table") {
    return {
      x: [...extractedFields.projections],
      y: [],
      breakdown: [],
    };
  }

  // For non-table charts, use the original logic
  // remove group by and timeseries field from projections, while using it on y axis
  const yAxisFields = extractedFields.projections.filter(
    (field) =>
      !extractedFields.group_by.includes(field) &&
      field !== extractedFields.timeseries_field,
  );

  const fields = {
    x: [] as string[],
    y: yAxisFields,
    breakdown: [] as string[],
  };

  // add timestamp as x axis
  if (extractedFields.timeseries_field) {
    fields.x.push(extractedFields.timeseries_field);
  }

  extractedFields.group_by.forEach((field: any) => {
    if (field != extractedFields.timeseries_field) {
      // if x axis is empty then first add group by as x axis
      if (fields.x.length == 0) {
        fields.x.push(field);
      } else {
        fields.breakdown.push(field);
      }
    }
  });

  return fields;
};
