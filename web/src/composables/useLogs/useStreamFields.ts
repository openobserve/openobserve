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

import { nextTick, ref } from "vue";
import { byString } from "@/utils/json";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { searchState } from "@/composables/useLogs/searchState";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";

import {
  useLocalLogFilterField,
  timestampToTimezoneDate,
  useLocalInterestingFields,
  convertToCamelCase,
  deepCopy,
} from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";

export const useStreamFields = () => {
  const { getStreams, getStream } = useStreams();
  const { updateFieldKeywords } = useSqlSuggestions();

  const store = useStore();
  const router = useRouter();
  const { t } = useI18n();

  let {
    searchObj,
    searchObjDebug,
    fieldValues,
    notificationMsg,
    streamSchemaFieldsIndexMapping,
  } = searchState();

  const { fnParsedSQL, getColumnWidth } = logsUtils();

  const updateFieldValues = () => {
    try {
      const excludedFields = [
        store.state.zoConfig.timestamp_column,
        "log",
        "msg",
      ];
      // searchObj.data.queryResults.hits.forEach((item: { [x: string]: any }) => {
      for (const item of searchObj.data.queryResults.hits) {
        // Create set for each field values and add values to corresponding set
        // Object.keys(item).forEach((key) => {
        for (const key of Object.keys(item)) {
          if (excludedFields.includes(key)) {
            return;
          }

          if (fieldValues.value === undefined) {
            fieldValues.value = {};
          }

          if (fieldValues.value[key] == undefined) {
            fieldValues.value[key] = new Set();
          }

          if (!fieldValues.value[key].has(item[key])) {
            fieldValues.value[key].add(item[key]);
          }
        }
      }
    } catch (e: any) {
      console.log("Error while updating field values", e);
    }
  };

  const extractFields = async () => {
    try {
      searchObjDebug["extractFieldsStartTime"] = performance.now();
      searchObjDebug["extractFieldsWithAPI"] = "";
      searchObj.data.errorMsg = "";
      searchObj.data.errorDetail = "";
      searchObj.data.countErrorMsg = "";
      searchObj.data.stream.selectedStreamFields = [];
      searchObj.data.stream.interestingFieldList = [];
      const schemaFields: any = [];
      const commonSchemaFields: any = [];
      if (searchObj.data.streamResults.list.length > 0) {
        const timestampField = store.state.zoConfig.timestamp_column;
        const allField = store.state.zoConfig?.all_fields_name;
        const schemaInterestingFields: string[] = [];
        let userDefineSchemaSettings: any = [];
        const schemaMaps: any = [];
        const commonSchemaMaps: any = [];
        const interestingSchemaMaps: any = [];
        const interestingCommonSchemaMaps: any = [];

        let schemaFieldsIndex: number = -1;
        let commonSchemaFieldsIndex: number = -1;
        let fieldObj: any = {};
        const localInterestingFields: any = useLocalInterestingFields();
        const streamInterestingFields: any = [];
        let streamInterestingFieldsLocal: any = [];

        const selectedStreamValues = searchObj.data.stream.selectedStream
          .join(",")
          .split(",");

        searchObj.data.stream.expandGroupRows = {
          common: true,
          ...Object.fromEntries(
            selectedStreamValues
              .sort()
              .map((stream: any) => [
                stream,
                searchObj.data.stream.expandGroupRows[stream] &&
                selectedStreamValues.length > 1
                  ? searchObj.data.stream.expandGroupRows[stream]
                  : selectedStreamValues.length > 1
                    ? false
                    : true,
              ]),
          ),
        };
        searchObj.data.stream.expandGroupRowsFieldCount = {
          common: 0,
          ...Object.fromEntries(
            selectedStreamValues.sort().map((stream: any) => [stream, 0]),
          ),
        };

        searchObj.data.stream.interestingExpandedGroupRows = deepCopy(
          searchObj.data.stream.expandGroupRows,
        );
        searchObj.data.stream.interestingExpandedGroupRowsFieldCount = deepCopy(
          searchObj.data.stream.expandGroupRowsFieldCount,
        );

        searchObj.data.datetime.queryRangeRestrictionMsg = "";
        searchObj.data.datetime.queryRangeRestrictionInHour = -1;

        const interestingFieldsMapping: { [key: string]: string[] } = {
          common: [],
          ...Object.fromEntries(
            selectedStreamValues.sort().map((stream: any) => [stream, []]),
          ),
        };

        const interestingFieldsMap: { [key: string]: boolean } = {};

        for (const stream of searchObj.data.streamResults.list) {
          if (searchObj.data.stream.selectedStream.includes(stream.name)) {
            if (searchObj.data.stream.selectedStream.length > 1) {
              schemaMaps.push({
                name: convertToCamelCase(stream.name),
                label: true,
                ftsKey: false,
                isSchemaField: false,
                showValues: false,
                group: stream.name,
                isExpanded: false,
                streams: [stream.name],
                isInterestingField: false,
              });

              interestingSchemaMaps.push(schemaMaps[schemaMaps.length - 1]);

              schemaFields.push("dummylabel");
              // searchObj.data.stream.expandGroupRowsFieldCount[stream.name] = searchObj.data.stream.expandGroupRowsFieldCount[stream.name] + 1;
            }

            // check for schema exist in the object or not
            // if not pull the schema from server.
            const streamData = await loadStreamFields(stream.name);
            if (streamData.schema === undefined) {
              searchObj.loadingStream = false;
              searchObj.data.errorMsg = t("search.noFieldFound");
              throw new Error(searchObj.data.errorMsg);
              return;
            }

            stream.settings = { ...streamData.settings };
            stream.schema = [...streamData.schema];

            userDefineSchemaSettings =
              stream.settings?.defined_schema_fields?.slice() || [];

            if (
              (stream.settings.max_query_range > 0 ||
                store.state.zoConfig.max_query_range > 0) &&
              (searchObj.data.datetime.queryRangeRestrictionInHour >
                stream.settings.max_query_range ||
                stream.settings.max_query_range == 0 ||
                searchObj.data.datetime.queryRangeRestrictionInHour == -1) &&
              searchObj.data.datetime.queryRangeRestrictionInHour != 0
            ) {
              //if stream has max_query_range, then use that, otherwise use the default max_query_range from the config
              searchObj.data.datetime.queryRangeRestrictionInHour =
                stream.settings.max_query_range > 0
                  ? stream.settings.max_query_range
                  : store.state.zoConfig.max_query_range;

              searchObj.data.datetime.queryRangeRestrictionMsg = t(
                "search.queryRangeRestrictionMsg",
                {
                  range:
                    searchObj.data.datetime.queryRangeRestrictionInHour > 1
                      ? searchObj.data.datetime.queryRangeRestrictionInHour +
                        " hours"
                      : searchObj.data.datetime.queryRangeRestrictionInHour +
                        " hour",
                },
              );
            }

            let environmentInterestingFields = new Set();
            if (
              store.state.zoConfig.hasOwnProperty("default_quick_mode_fields")
            ) {
              environmentInterestingFields = new Set(
                store.state?.zoConfig?.default_quick_mode_fields,
              );
            }

            if (
              stream.settings.hasOwnProperty("defined_schema_fields") &&
              userDefineSchemaSettings.length > 0
            ) {
              searchObj.meta.hasUserDefinedSchemas = true;
              if (store.state.zoConfig.hasOwnProperty("timestamp_column")) {
                userDefineSchemaSettings.push(
                  store.state.zoConfig?.timestamp_column,
                );
              }

              if (store.state.zoConfig.hasOwnProperty("all_fields_name")) {
                userDefineSchemaSettings.push(
                  store.state.zoConfig?.all_fields_name,
                );
              }
            } else {
              searchObj.meta.hasUserDefinedSchemas =
                searchObj.meta.hasUserDefinedSchemas &&
                searchObj.data.stream.selectedStream.length > 1;
            }

            // remove timestamp field from the local interesting fields and update the local interesting fields. As timestamp field is default interesting field, we don't need to add it to the local storage
            if (hasInterestingFieldsInLocal(stream.name)) {
              const hasTimestampField = localInterestingFields.value[
                searchObj.organizationIdentifier + "_" + stream.name
              ].some(
                (field: any) =>
                  field === store.state.zoConfig?.timestamp_column,
              );

              // remove timestamp field from the local interesting fields and update the local interesting fields
              if (hasTimestampField) {
                localInterestingFields.value[
                  searchObj.organizationIdentifier + "_" + stream.name
                ] = localInterestingFields.value[
                  searchObj.organizationIdentifier + "_" + stream.name
                ].filter(
                  (field: any) =>
                    field !== store.state.zoConfig?.timestamp_column,
                );
              }

              useLocalInterestingFields(localInterestingFields.value);
            }

            const deselectedFields =
              localInterestingFields.value?.[
                "deselect" +
                  "_" +
                  searchObj.organizationIdentifier +
                  "_" +
                  stream.name
              ];

            // Check if all deselected fields are present in the environment interesting fields
            if (deselectedFields && deselectedFields.length > 0) {
              localInterestingFields.value[
                "deselect" +
                  "_" +
                  searchObj.organizationIdentifier +
                  "_" +
                  stream.name
              ] = Array.from(deselectedFields).filter((field: any) =>
                environmentInterestingFields.has(field),
              );
            }

            const filteredDeselectedFields = new Set(
              localInterestingFields.value?.[
                "deselect" +
                  "_" +
                  searchObj.organizationIdentifier +
                  "_" +
                  stream.name
              ] || [],
            );

            const filteredEnvironmentInterestingFields = Array.from(
              environmentInterestingFields,
            ).filter((field: any) => !filteredDeselectedFields.has(field));

            streamInterestingFieldsLocal = hasInterestingFieldsInLocal(
              stream.name,
            )
              ? [
                  ...localInterestingFields.value?.[
                    searchObj.organizationIdentifier + "_" + stream.name
                  ],
                  ...filteredEnvironmentInterestingFields,
                ]
              : [...filteredEnvironmentInterestingFields];

            // Add timestamp column to the interesting field list if it is not present in the interesting field list
            const intField = new Set([
              ...searchObj.data.stream.interestingFieldList,
              ...streamInterestingFieldsLocal,
              store.state.zoConfig?.timestamp_column,
            ]);

            searchObj.data.stream.interestingFieldList = Array.from(intField);

            searchObj.data.stream.interestingFieldList.forEach((field: any) => {
              if (interestingFieldsMap[field] === undefined) {
                interestingFieldsMap[field] = false;
              }
            });

            // create a schema field mapping based on field name to avoid iteration over object.
            // in case of user defined schema consideration, loop will be break once all defined fields are mapped.
            let UDSFieldCount = 0;
            const fields: [string] =
              stream.settings?.defined_schema_fields &&
              searchObj.meta.useUserDefinedSchemas === "user_defined_schema"
                ? [
                    store.state.zoConfig?.timestamp_column,
                    ...stream.settings?.defined_schema_fields,
                    store.state.zoConfig?.all_fields_name,
                  ]
                : stream.schema.map((obj: any) => obj.name);
            for (const field of fields) {
              fieldObj = {
                name: field,
                ftsKey:
                  stream.settings.full_text_search_keys.indexOf(field) > -1
                    ? true
                    : false,
                isSchemaField: true,
                group: stream.name,
                streams: [stream.name],
                showValues: field !== timestampField && field !== allField,
                isInterestingField:
                  searchObj.data.stream.interestingFieldList.includes(field)
                    ? true
                    : false,
              };

              if (
                store.state.zoConfig.user_defined_schemas_enabled &&
                searchObj.meta.useUserDefinedSchemas == "user_defined_schema" &&
                stream.settings.hasOwnProperty("defined_schema_fields") &&
                userDefineSchemaSettings.length > 0
              ) {
                if (userDefineSchemaSettings.includes(field)) {
                  schemaFieldsIndex = schemaFields.indexOf(field);
                  commonSchemaFieldsIndex = commonSchemaFields.indexOf(field);
                  if (schemaFieldsIndex > -1) {
                    fieldObj.group = "common";

                    if (
                      schemaMaps[schemaFieldsIndex].hasOwnProperty("streams") &&
                      schemaMaps[schemaFieldsIndex].streams.length > 0
                    ) {
                      fieldObj.streams.push(
                        ...schemaMaps[schemaFieldsIndex].streams,
                      );
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        schemaMaps[schemaFieldsIndex].streams[0]
                      ] =
                        searchObj.data.stream.expandGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] - 1;
                    }

                    commonSchemaMaps.push(fieldObj);

                    if (fieldObj.isInterestingField) {
                      interestingCommonSchemaMaps.push(fieldObj);
                      interestingFieldsMapping["common"].push(fieldObj.name);
                      interestingFieldsMap[fieldObj.name] = true;
                      searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                        "common"
                      ] =
                        searchObj.data.stream
                          .interestingExpandedGroupRowsFieldCount["common"] + 1;

                      if (
                        searchObj.data.stream
                          .interestingExpandedGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] > 0 &&
                        interestingFieldsMapping[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ].includes(fieldObj.name)
                      ) {
                        searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] =
                          searchObj.data.stream
                            .interestingExpandedGroupRowsFieldCount[
                            schemaMaps[schemaFieldsIndex].streams[0]
                          ] - 1;
                      }
                    }

                    commonSchemaFields.push(field);
                    searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        "common"
                      ] + 1;

                    //remove the element from the index
                    schemaFields.splice(schemaFieldsIndex, 1);
                    schemaMaps.splice(schemaFieldsIndex, 1);
                    const index = interestingSchemaMaps.findIndex(
                      (item: any) => item.name == field,
                    );
                    if (index > -1) {
                      interestingSchemaMaps.splice(index, 1);
                    }
                  } else if (commonSchemaFieldsIndex > -1) {
                    commonSchemaMaps[commonSchemaFieldsIndex].streams.push(
                      stream.name,
                    );
                    // searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                    //   searchObj.data.stream.expandGroupRowsFieldCount[
                    //     "common"
                    //   ] + 1;
                  } else {
                    schemaMaps.push(fieldObj);
                    if (fieldObj.isInterestingField) {
                      interestingSchemaMaps.push(fieldObj);
                      interestingFieldsMapping[stream.name].push(fieldObj.name);
                      interestingFieldsMap[fieldObj.name] = true;
                      searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                        stream.name
                      ] =
                        searchObj.data.stream
                          .interestingExpandedGroupRowsFieldCount[stream.name] +
                        1;
                    }
                    schemaFields.push(field);
                    searchObj.data.stream.expandGroupRowsFieldCount[
                      stream.name
                    ] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        stream.name
                      ] + 1;
                  }

                  if (UDSFieldCount < userDefineSchemaSettings.length) {
                    UDSFieldCount++;
                  } else {
                    break;
                  }
                }

                // if (schemaMaps.length == userDefineSchemaSettings.length) {
                //   break;
                // }
              } else {
                schemaFieldsIndex = schemaFields.indexOf(field);
                commonSchemaFieldsIndex = commonSchemaFields.indexOf(field);
                if (schemaFieldsIndex > -1) {
                  fieldObj.group = "common";
                  if (
                    schemaMaps[schemaFieldsIndex].hasOwnProperty("streams") &&
                    schemaMaps[schemaFieldsIndex].streams.length > 0
                  ) {
                    fieldObj.streams.push(
                      ...schemaMaps[schemaFieldsIndex].streams,
                    );

                    searchObj.data.stream.expandGroupRowsFieldCount[
                      schemaMaps[schemaFieldsIndex].streams[0]
                    ] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        schemaMaps[schemaFieldsIndex].streams[0]
                      ] - 1;

                    if (fieldObj.isInterestingField) {
                      if (
                        searchObj.data.stream
                          .interestingExpandedGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] > 0 &&
                        interestingFieldsMapping[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ].includes(fieldObj.name)
                      ) {
                        searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] =
                          searchObj.data.stream
                            .interestingExpandedGroupRowsFieldCount[
                            schemaMaps[schemaFieldsIndex].streams[0]
                          ] - 1;
                      }
                    }
                  }

                  commonSchemaMaps.push(fieldObj);

                  if (fieldObj.isInterestingField) {
                    interestingCommonSchemaMaps.push(fieldObj);
                    interestingFieldsMapping["common"].push(fieldObj.name);
                    interestingFieldsMap[fieldObj.name] = true;
                    searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                      "common"
                    ] =
                      searchObj.data.stream
                        .interestingExpandedGroupRowsFieldCount["common"] + 1;
                  }
                  commonSchemaFields.push(field);
                  searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                    searchObj.data.stream.expandGroupRowsFieldCount["common"] +
                    1;

                  //remove the element from the index
                  schemaFields.splice(schemaFieldsIndex, 1);
                  schemaMaps.splice(schemaFieldsIndex, 1);
                  const index = interestingSchemaMaps.findIndex(
                    (item: any) => item.name == field,
                  );
                  if (index > -1) {
                    interestingSchemaMaps.splice(index, 1);
                  }
                } else if (commonSchemaFieldsIndex > -1) {
                  commonSchemaMaps[commonSchemaFieldsIndex].streams.push(
                    stream.name,
                  );
                  // searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                  //   searchObj.data.stream.expandGroupRowsFieldCount["common"] +
                  //   1;
                } else {
                  schemaMaps.push(fieldObj);

                  if (fieldObj.isInterestingField) {
                    interestingSchemaMaps.push(fieldObj);
                    interestingFieldsMapping[stream.name].push(fieldObj.name);
                    interestingFieldsMap[fieldObj.name] = true;
                    searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                      stream.name
                    ] =
                      searchObj.data.stream
                        .interestingExpandedGroupRowsFieldCount[stream.name] +
                      1;
                  }
                  schemaFields.push(field);
                  searchObj.data.stream.expandGroupRowsFieldCount[stream.name] =
                    searchObj.data.stream.expandGroupRowsFieldCount[
                      stream.name
                    ] + 1;
                }
              }
            }

            if (
              searchObj.data.stream.selectedStream.length > 1 &&
              commonSchemaFields.length == 0
            ) {
              commonSchemaMaps.unshift({
                name: "Common Group Fields",
                label: true,
                ftsKey: false,
                isSchemaField: false,
                showValues: false,
                group: "common",
                isExpanded: false,
                streams: [stream.name],
                isInterestingField: false,
              });

              interestingCommonSchemaMaps.unshift(commonSchemaMaps[0]);
              interestingFieldsMapping["common"].unshift(commonSchemaMaps[0]);

              commonSchemaFields.unshift("dummylabel");
              // searchObj.data.stream.expandGroupRowsFieldCount["common"] = searchObj.data.stream.expandGroupRowsFieldCount["common"] + 1;
            }
            //here we check whether timestamp field is present or not
            //as we append timestamp dynamically for userDefined schema we need to check this
            if (
              userDefineSchemaSettings.includes(
                store.state.zoConfig?.timestamp_column,
              )
            ) {
              searchObj.data.hasSearchDataTimestampField = true;
            } else {
              searchObj.data.hasSearchDataTimestampField = false;
            }

            // check for user defined schema is false then only consider checking new fields from result set
            if (
              searchObj.data.queryResults.hasOwnProperty("hits") &&
              searchObj.data.queryResults?.hits.length > 0 &&
              searchObj.data.stream.selectedStream.length == 1 &&
              (!store.state.zoConfig.user_defined_schemas_enabled ||
                !searchObj.meta.hasUserDefinedSchemas)
            ) {
              // Find the index of the record with max attributes
              const maxAttributesIndex =
                searchObj.data.queryResults.hits.reduce(
                  (
                    maxIndex: string | number,
                    obj: {},
                    currentIndex: any,
                    array: { [x: string]: {} },
                  ) => {
                    const numAttributes = Object.keys(obj).length;
                    const maxNumAttributes = Object.keys(
                      array[maxIndex],
                    ).length;
                    return numAttributes > maxNumAttributes
                      ? currentIndex
                      : maxIndex;
                  },
                  0,
                );

              const recordwithMaxAttribute =
                searchObj.data.queryResults.hits[maxAttributesIndex];

              // Object.keys(recordwithMaxAttribute).forEach((key) => {
              for (const key of Object.keys(recordwithMaxAttribute)) {
                if (
                  key == "_o2_id" ||
                  key == "_original" ||
                  key == "_all_values"
                ) {
                  continue;
                }
                if (key == store.state.zoConfig.timestamp_column) {
                  searchObj.data.hasSearchDataTimestampField = true;
                }
                if (
                  !schemaFields.includes(key) &&
                  !commonSchemaFields.includes(key) &&
                  key != "_stream_name"
                ) {
                  fieldObj = {
                    name: key,
                    type: "Utf8",
                    ftsKey: false,
                    group: stream.name,
                    isSchemaField: false,
                    showValues: false,
                    isInterestingField:
                      searchObj.data.stream.interestingFieldList.includes(key)
                        ? true
                        : false,
                    streams: [],
                  };
                  schemaMaps.push(fieldObj);

                  if (fieldObj.isInterestingField) {
                    interestingSchemaMaps.push(fieldObj);
                    interestingFieldsMapping[stream.name].push(fieldObj);
                    interestingFieldsMap[fieldObj.name] = true;
                  }
                  schemaFields.push(key);
                }
              }
            }
            searchObj.data.stream.userDefinedSchema =
              userDefineSchemaSettings || [];
          }
        }
        searchObj.data.stream.interestingFieldList = Object.keys(
          interestingFieldsMap,
        ).filter((field: any) => interestingFieldsMap[field]);

        // searchObj.data.stream.selectedStreamFields = schemaMaps;
        searchObj.data.stream.selectedStreamFields = [
          ...commonSchemaMaps,
          ...schemaMaps,
        ];

        searchObj.data.stream.selectedInterestingStreamFields = [
          ...interestingCommonSchemaMaps,
          ...interestingSchemaMaps,
        ];

        if (
          searchObj.data.stream.selectedStreamFields != undefined &&
          searchObj.data.stream.selectedStreamFields.length
        )
          updateFieldKeywords(searchObj.data.stream.selectedStreamFields);

        createFieldIndexMapping();
      }
      searchObjDebug["extractFieldsEndTime"] = performance.now();
    } catch (e: any) {
      searchObj.loadingStream = false;
      console.log("Error while extracting fields.", e);
      notificationMsg.value = "Error while extracting stream fields.";
    }
  };

  const loadStreamFields = async (streamName: string) => {
    try {
      if (streamName != "") {
        searchObj.loadingStream = true;
        return await getStream(
          streamName,
          searchObj.data.stream.streamType || "logs",
          true,
        ).then((res) => {
          searchObj.loadingStream = false;
          return res;
        });
      } else {
        searchObj.data.errorMsg = "No stream found in selected organization!";
      }
      return;
    } catch (e: any) {
      searchObj.loadingStream = false;
      console.log("Error while loading stream fields");
    }
  };

  const getStreamList = async (selectStream: boolean = true) => {
    try {
      // commented below function as we are doing resetStreamData from all the places where getStreamList is called
      // resetStreamData();
      const streamType = searchObj.data.stream.streamType || "logs";
      const streamData: any = await getStreams(streamType, false);
      searchObj.data.streamResults = {
        ...streamData,
      };
      await nextTick();
      await loadStreamLists(selectStream);
      return;
    } catch (e: any) {
      console.error("Error while getting stream list", e);
    }
  };

  const loadStreamLists = async (selectStream: boolean = true) => {
    try {
      if (searchObj.data.streamResults.list.length > 0) {
        let lastUpdatedStreamTime = 0;

        let selectedStream: any[] = [];

        searchObj.data.stream.streamLists = [];
        let itemObj: {
          label: string;
          value: string;
        };

        for (const item of searchObj.data.streamResults.list) {
          itemObj = {
            label: item.name,
            value: item.name,
          };

          searchObj.data.stream.streamLists.push(itemObj);

          // If isFirstLoad is true, then select the stream from query params
          if (router.currentRoute.value?.query?.stream == item.name) {
            selectedStream.push(itemObj.value);
          }
          if (
            !router.currentRoute.value?.query?.stream &&
            item.stats.doc_time_max >= lastUpdatedStreamTime
          ) {
            selectedStream = [];
            lastUpdatedStreamTime = item.stats.doc_time_max;
            selectedStream.push(itemObj.value);
          }
        }
        if (
          (store.state.zoConfig.query_on_stream_selection == false ||
            router.currentRoute.value.query?.type == "stream_explorer") &&
          selectStream
        ) {
          searchObj.data.stream.selectedStream = selectedStream;
        }
      } else {
        searchObj.data.errorMsg = "No stream found in selected organization!";
      }
      return;
    } catch (e: any) {
      console.log("Error while loading stream list");
    }
  };

  const resetFieldValues = () => {
    fieldValues.value = {};
  };

  const hasInterestingFieldsInLocal = (streamName: string) => {
    const localInterestingFields: any = useLocalInterestingFields();
    return (
      localInterestingFields.value != null &&
      localInterestingFields.value[
        searchObj.organizationIdentifier + "_" + streamName
      ] !== undefined &&
      localInterestingFields.value[
        searchObj.organizationIdentifier + "_" + streamName
      ].length > 0
    );
  };

  const createFieldIndexMapping = async () => {
    Promise.resolve().then(() => {
      streamSchemaFieldsIndexMapping.value = {};
      for (
        let i = 0;
        i < searchObj.data.stream.selectedStreamFields.length;
        i++
      ) {
        streamSchemaFieldsIndexMapping.value[
          searchObj.data.stream.selectedStreamFields[i].name
        ] = i;
      }
    });
  };

  const updateGridColumns = () => {
    try {
      searchObj.data.resultGrid.columns = [];

      const logFilterField: any =
        useLocalLogFilterField()?.value != null
          ? useLocalLogFilterField()?.value
          : {};
      const logFieldSelectedValue: any = [];
      const stream = searchObj.data.stream.selectedStream.sort().join("_");
      // Check if logFilterField has keys (since it's an object, not an array)
      if (
        Object.keys(logFilterField).length > 0 &&
        logFilterField[
          `${store.state.selectedOrganization.identifier}_${stream}`
        ] != undefined &&
        Array.isArray(
          logFilterField[
            `${store.state.selectedOrganization.identifier}_${stream}`
          ],
        )
      ) {
        logFieldSelectedValue.push(
          ...logFilterField[
            `${store.state.selectedOrganization.identifier}_${stream}`
          ],
        );
      }

      let selectedFields = (
        (logFilterField && logFieldSelectedValue) ||
        []
      ).filter(
        (_field) =>
          _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      if (
        searchObj.data.stream.selectedFields.length == 0 &&
        selectedFields.length > 0
      ) {
        return (searchObj.data.stream.selectedFields = selectedFields);
      }

      // As in saved view, we observed field getting duplicated in selectedFields
      // So, we are removing duplicates before applying saved view
      if (searchObj.data.stream.selectedFields?.length) {
        selectedFields = [...new Set(searchObj.data.stream.selectedFields)];
      }

      const parsedSQL: any = fnParsedSQL();

      // By default when no fields are selected. Timestamp and Source will be visible. If user selects field, then only selected fields will be visible in table
      // In SQL and Quick mode.
      // If user adds timestamp manually then only we get it in response.
      // If we don’t add timestamp and add timestamp to table it should show invalid date.

      if (
        selectedFields.length == 0 ||
        !searchObj.data.queryResults?.hits?.length
      ) {
        searchObj.meta.resultGrid.manualRemoveFields = false;
        if (
          (searchObj.meta.sqlMode == true &&
            parsedSQL.hasOwnProperty("columns") &&
            searchObj.data.queryResults?.hits[0].hasOwnProperty(
              store.state.zoConfig.timestamp_column,
            )) ||
          searchObj.meta.sqlMode == false ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.push({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestamp") + ` (${store.state.timezone})`,
            header: t("search.timestamp") + ` (${store.state.timezone})`,
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            size: 260,
          });
        }

        if (selectedFields.length == 0) {
          searchObj.data.resultGrid.columns.push({
            name: "source",
            id: "source",
            accessorFn: (row: any) => JSON.stringify(row),
            cell: (info: any) => info.getValue(),
            header: "source",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
          });
        }
      } else {
        if (
          searchObj.data.queryResults.hits?.some((item: any) =>
            item.hasOwnProperty(store.state.zoConfig.timestamp_column),
          ) ||
          searchObj.data.hasSearchDataTimestampField ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.unshift({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestamp") + ` (${store.state.timezone})`,
            header: t("search.timestamp") + ` (${store.state.timezone})`,
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            size: 260,
          });
        }

        let sizes: any;
        if (
          searchObj.data.resultGrid.colSizes &&
          searchObj.data.resultGrid.colSizes.hasOwnProperty(
            searchObj.data.stream.selectedStream,
          )
        ) {
          sizes =
            searchObj.data.resultGrid.colSizes[
              searchObj.data.stream.selectedStream
            ];
        }

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        for (const field of selectedFields) {
          if (field != store.state.zoConfig.timestamp_column) {
            let foundKey, foundValue;

            if (sizes?.length > 0) {
              Object.keys(sizes[0]).forEach((key) => {
                const trimmedKey = key
                  .replace(/^--(header|col)-/, "")
                  .replace(/-size$/, "");
                if (trimmedKey === field) {
                  foundKey = key;
                  foundValue = sizes[0][key];
                }
              });
            }

            searchObj.data.resultGrid.columns.push({
              name: field,
              id: field,
              accessorFn: (row: { [x: string]: any; source: any }) => {
                return byString(row, field);
              },
              header: field,
              sortable: true,
              enableResizing: true,
              meta: {
                closable: true,
                showWrap: true,
                wrapContent: false,
              },
              size: foundValue ? foundValue : getColumnWidth(context, field),
              maxSize: window.innerWidth,
            });
          }
        }
      }

      extractFTSFields();
    } catch (e: any) {
      searchObj.loadingStream = false;
      notificationMsg.value = "Error while updating table columns.";
    }
  };

  const ftsFields: any = ref([]);
  const extractFTSFields = () => {
    if (
      searchObj.data.stream.selectedStreamFields != undefined &&
      searchObj.data.stream.selectedStreamFields.length > 0
    ) {
      ftsFields.value = searchObj.data.stream.selectedStreamFields
        .filter((item: any) => item.ftsKey === true)
        .map((item: any) => item.name);
    }

    // if there is no FTS fields set by user then use default FTS fields
    if (ftsFields.value.length == 0) {
      ftsFields.value = store.state.zoConfig.default_fts_keys;
    }
  };

  const filterHitsColumns = () => {
    searchObj.data.queryResults.filteredHit = [];
    let itemHits: any = {};
    if (searchObj.data.stream.selectedFields.length > 0) {
      searchObj.data.queryResults.hits.map((hit: any) => {
        itemHits = {};
        // searchObj.data.stream.selectedFields.forEach((field) => {
        for (const field of searchObj.data.stream.selectedFields) {
          if (hit.hasOwnProperty(field)) {
            itemHits[field] = hit[field];
          }
        }
        itemHits[store.state.zoConfig.timestamp_column] =
          hit[store.state.zoConfig.timestamp_column];
        searchObj.data.queryResults.filteredHit.push(itemHits);
      });
    } else {
      searchObj.data.queryResults.filteredHit =
        searchObj.data.queryResults.hits;
    }
  };

  return {
    updateFieldValues,
    extractFields,
    loadStreamFields,
    getStreamList,
    loadStreamLists,
    resetFieldValues,
    hasInterestingFieldsInLocal,
    createFieldIndexMapping,
    updateGridColumns,
    extractFTSFields,
    filterHitsColumns,
  };
};

export default useStreamFields;
