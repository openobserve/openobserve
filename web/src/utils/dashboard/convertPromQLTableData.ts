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

/**
 * Converts table data based on the panel schema and search query data.
 *
 * @param {any} panelSchema - The panel schema containing queries and fields.
 * @param {any} searchQueryData - The search query data.
 * @return {object} An object containing rows and columns.
 */
export const convertPromQLTableData = (
  panelSchema: any,
  searchQueryData: any
) => {
  
  // display name object for each column
  const filedNameObj: any = {};
  // in table, we will have single column for each query.
  for(let i=0;i<panelSchema?.queries?.length;i++){
    filedNameObj["query "+(i+1)] = "Query " + (i+1);
  }  

  // need to use display name override
  panelSchema?.config?.overrides?.forEach((override: any) => {
    // if matcher is byName
    if (override?.matcher?.id === "byName") {
      // iterate over each properties
      override?.properties?.forEach((property: any) => {
        // if property id is display name
        if(property?.id === "displayName" && property?.value){
          // set the display name
          filedNameObj[override?.matcher?.options] = property?.value;
        }
      })
    }
  });  
  
  // for each columns/querys values, we will find average
  const data = searchQueryData?.map((it: any) => {
    return it?.result?.map((res:any)=>{
      // if array then need to find average else simply return value by converting into number
      res.values = Array.isArray(res?.values) ? ((res?.values?.reduce((acc: any, cur: any) => acc + (+cur[1]||0),0) || 1)/(res?.values?.length||1))?.toFixed(2) : +(res?.values) ?? 0;
      return JSON.parse(JSON.stringify(res));
    })
  })

  const tableObject:any = {};

  data?.forEach((sublist:any,columnIndex:any) => {
    sublist?.forEach((item:any) => {
        const metric = JSON.stringify(item.metric);
        const value = item.values;
        
        if (!tableObject[metric]) {
            tableObject[metric] = {
              name:metric
            };
        }
        
        tableObject[metric][filedNameObj["query " + (columnIndex+1)]] = value;
    });
});

const columns=[{
  name:"name",
  field:"name",
  sortable:true,
  align:"left",
  label :"name"
}];
for(let i=1;i<=searchQueryData.length;i++){
    let obj: any = {};
    obj["name"] = filedNameObj["query " + i];
    obj["field"] = filedNameObj["query " + i];
    obj["label"] = filedNameObj["query " + i];
    obj["sortable"] = true;
    obj["align"] = "right";
    columns.push(obj);
};
  
  return {
    rows: Object.values(tableObject),
    columns:columns,
  };
};
