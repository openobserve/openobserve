// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

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

  const x = props.data?.value?.queries[0].fields?.x || [];
  const y = props.data?.value?.queries[0].fields?.y || [];
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
