// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { cloneDeep } from "lodash-es";
import { reactive, ref } from "vue";

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
    totalMetricValues: 1000,
  },
  data: {
    errorMsg: "",
    errorCode: 0,
    additionalErrorMsg: "",
    metrics: {
      metricList: <any>[],
      selectedMetric: null as null | {
        type: string;
        name: string;
        value: string;
        help: string;
      },
      selectedMetricType: "",
    },
    queryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{},
    datetime: {
      startTime: "",
      endTime: "",
      relativeTimePeriod: "15m",
      type: "relative",
    },
    query: "",
  },
};

const searchObj = ref(cloneDeep(defaultObject));

const useMetrics = () => {
  const resetSearchObj = () => {
    // delete searchObj.data;
    searchObj.value = cloneDeep(defaultObject);
  };

  return { searchObj: searchObj.value, resetSearchObj };
};

export default useMetrics;
