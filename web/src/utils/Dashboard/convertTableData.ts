export const convertTableData = (
  panelSchema: any,
  searchQueryDataTemp: any
) => {
  const searchQueryData = {
    data: searchQueryDataTemp,
  };

  const props = {
    data: panelSchema,
  };

  const isSampleValuesNumbers = (arr: any, key: string, sampleSize: number) => {
    if (!Array.isArray(arr)) {
      return false;
    }
    const sample = arr.slice(0, Math.min(sampleSize, arr.length));
    return sample.every((obj) => {
      const value = obj[key];
      return (
        value === undefined ||
        value === null ||
        value === "" ||
        typeof value === "number"
      );
    });
  };

  const x = props.data?.fields?.x || [];
  const y = props.data?.fields?.y || [];
  const columnData = [...x, ...y];

  const columns = columnData.map((it: any) => {
    let obj: any = {};
    obj["name"] = it.label;
    obj["field"] = it.alias;
    obj["label"] = it.label;
    obj["align"] = !isSampleValuesNumbers(searchQueryData.data, it.alias, 20)
      ? "left"
      : "right";
    obj["sortable"] = true;
    return obj;
  });

  return {
    rows: searchQueryData.data,
    columns,
  };
};
