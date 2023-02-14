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

import { reactive } from "vue";
import { useLocalLogsObj } from "../utils/zincutils";

const defaultObject = {
    organizationIdetifier: "",
    runQuery: false,
    loading: false,

    config: {
        splitterModel: 20,
        lastSplitterPosition:0,
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
        refreshInterval: "0",
        refreshIntervalLabel: "Off",
        showFields: true,
        showQuery: true,
        showHistogram: true,
        showDetailTab: false,
        sqlMode: false,
        resultGrid: {
            wrapCells: false,
            manualRemoveFields: false,
            rowsPerPage: 1000,
            chartInterval: "1 second",
            chartKeyFormat: "HH:mm:ss",
            navigation: {
                currentRowIndex: 0,
            }
        },
        scrollInfo:{}
    },
    data: {
        query: "",
        parsedQuery: {},
        errorMsg: "",
        additionalErrorMsg: "",
        stream: {
            streamLists: [],
            selectedStream: {label: "", value: ""},
            selectedStreamFields: [],
            selectedFields:<string[]> [],
            filterField: "",
            addToFilter: "",
            functions: [],
        },
        resultGrid: {
            currentDateTime: new Date(),
            currentPage:0,
            columns:<any> [],
        },
        transforms:<any> [],
        queryResults: <any>[],
        sortedQueryResults: <any>[],
        streamResults: <any>[],
        histogram: <any>{},
        editorValue: "",
        datetime: {
            tab: "relative",
            relative: {
                period: {
                    label: "Minutes",
                    value: "Minutes",
                },
                value: 15,
            },
            absolute: {
                date: {
                    from: "",
                    to: "",
                },
                startTime: "00:00",
                endTime: "23:59"
            }
        }
    }
}

// let searchObj = reactive(structuredClone(defaultObject));
// let localLogsObj:any = useLocalLogsObj();
// let searchObj = {};
// if (typeof localLogsObj === "object") {
    // searchObj = localLogsObj.value;
// } else {
    let searchObj = reactive(Object.assign({}, defaultObject));    
// }

const useLogs = () => {
    const resetSearchObj = () => {
        // delete searchObj.data;
        searchObj = reactive(Object.assign({}, defaultObject));

    }
    return { searchObj , resetSearchObj };
}

export default useLogs;