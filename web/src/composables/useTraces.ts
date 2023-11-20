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

import { reactive } from "vue";
import { useLocalTraceFilterField } from "@/utils/zincutils";

const defaultObject = {
  organizationIdetifier: "",
  runQuery: false,
  loading: false,

  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
    refreshTimes: [
      [
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ],
      [
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ],
      [
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ],
      [
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ],
    ],
  },
  meta: {
    refreshInterval: 0,
    refreshIntervalLabel: "Off",
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    showTraceDetails: false,
    sqlMode: false,
    resultGrid: {
      wrapCells: false,
      manualRemoveFields: false,
      rowsPerPage: 25,
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
    },
    scrollInfo: {},
    serviceColors: {} as any,
  },
  data: {
    query: "",
    parsedQuery: {},
    errorMsg: "",
    errorCode: 0,
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [],
      selectedFields: <string[]>[],
      filterField: "",
      addToFilter: "",
      functions: [],
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 0,
      columns: <any>[],
    },
    queryPayload: <any>{},
    transforms: <any>[],
    queryResults: <any>[],
    sortedQueryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{},
    editorValue: "",
    datetime: {
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    searchAround: {
      indexTimestamp: 0,
      size: <number>10,
      histogramHide: false,
    },
    traceDetails: {
      traceId: "",
      spanList: [],
      loading: false,
      selectedSpanId: null as string | null,
      showSpanDetails: false,
    },
  },
};

let searchObj = reactive(Object.assign({}, defaultObject));

const useLogs = () => {
  const resetSearchObj = () => {
    // delete searchObj.data;
    searchObj = reactive(Object.assign({}, defaultObject));
  };
  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdetifier || "default";
    const selectedFields: any =
      useLocalTraceFilterField()?.value != null
        ? useLocalTraceFilterField()?.value
        : {};
    selectedFields[
      `${identifier}_${searchObj.data.stream.selectedStream.value}`
    ] = searchObj.data.stream.selectedFields;
    useLocalTraceFilterField(selectedFields);
  };

  return { searchObj, resetSearchObj, updatedLocalLogFilterField };
};

export default useLogs;
