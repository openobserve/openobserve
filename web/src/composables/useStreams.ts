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

import { useStore } from "vuex";
import StreamService from "@/services/stream";
import { computed, ComputedRef, reactive } from "vue";
import { ref } from "vue";
import { useQuasar } from "quasar";
import { deepCopy } from "@/utils/zincutils";

const getStreamsPromise: any = ref(null);

const useStreams = () => {
  const store = useStore();

  const updateStreamsInStore = (streamType: string, streams: any) => {
    store.dispatch("streams/setStreams", { streamType, streams });
  };

  const updateStreamIndexMappingInStore = (streamIndexMapping: any) => {
    store.commit("streams/updateStreamIndexMapping", streamIndexMapping);
  };

  const updateStreamsFetchedInStore = (areAllStreamsFetched: any) => {
    store.commit("streams/updateStreamsFetched", areAllStreamsFetched);
  };

  const streamsCache: { [key: string]: ComputedRef<any> } = {
    logs: computed(() => store.state.streams.logs),
    metrics: computed(() => store.state.streams.metrics),
    traces: computed(() => store.state.streams.traces),
    enrichment_tables: computed(() => store.state.streams.enrichment_tables),
    index: computed(() => store.state.streams.index),
    metadata: computed(() => store.state.streams.metadata),
  };

  const q = useQuasar();

  const getStreams = async (
    _streamName: string = "",
    schema: boolean,
    notify: boolean = true,
    force: boolean = false,
  ) => {
    return new Promise(async (resolve, reject) => {
      const streamName = _streamName || "all";

      // We don't fetch schema while fetching all streams or specific type all streams
      // So keeping it false, don't change this
      schema = false;
      if (getStreamsPromise.value) {
        await getStreamsPromise.value;
      }
      try {
        if (!isStreamFetched(streamName || "all") || force) {
          // Added adddtional check to fetch all streamstype separately if streamName is all
          const dismiss = notify
            ? q.notify({
                spinner: true,
                message: "Please wait while loading streams...",
                timeout: 5000,
              })
            : () => {};
          if (streamName === "all") {
            // As in RBAC there can be permission on certain types of streams
            // So here added some additional logic to handle those

            const streamList = [
              "logs",
              "metrics",
              "traces",
              "enrichment_tables",
              "index",
              "metadata",
            ];

            const streamsToFetch = streamList.filter(
              (_streamType) => !streamsCache[_streamType]?.value,
            );

            getStreamsPromise.value = Promise.allSettled(
              [...streamsToFetch].map((streamType) =>
                StreamService.nameList(
                  store.state.selectedOrganization.identifier,
                  streamType,
                  schema,
                ),
              ),
            );

            getStreamsPromise.value
              .then((results: any) => {
                results.forEach((result: any, index: number) => {
                  if (
                    result.status === "fulfilled" &&
                    Object.hasOwn(result, "value") &&
                    result?.value?.data?.list.length > 0
                  ) {
                    setStreams(
                      streamsToFetch[index],
                      result?.value?.data?.list,
                    );
                  }
                });

                updateStreamsFetchedInStore(
                  streamList.every((stream) => !!streamsCache[stream].value),
                );

                getStreamsPromise.value = null;

                dismiss();
                resolve(getAllStreamsPayload());
              })
              .catch((e: any) => {
                getStreamsPromise.value = null;
                dismiss();
                reject(new Error(e.message));
              });
          } else {
            getStreamsPromise.value = StreamService.nameList(
              store.state.selectedOrganization.identifier,
              _streamName,
              schema,
            );
            getStreamsPromise.value
              .then((res: any) => {
                setStreams(streamName, res.data.list);
                const streamData = {
                  name: streamName,
                  list: res.data.list,
                  schema: false,
                };
                getStreamsPromise.value = null;
                dismiss();
                resolve(streamData);
              })
              .catch((e: any) => {
                getStreamsPromise.value = null;
                dismiss();
                reject(new Error(e.message));
              });
          }
        } else {
          if (streamName === "all") {
            resolve(getAllStreamsPayload());
          } else {
            resolve(streamsCache[streamName].value || {});
          }
        }
      } catch (e: any) {
        reject(new Error(e.message));
      }
    });
  };

  const getPaginatedStreams = async (
    _streamType: string = "",
    schema: boolean,
    notify: boolean = true,
    offset: number = 0,
    limit: number = 100,
    keyword: string = "",
    sort: string = "",
    asc: boolean = false,
  ) => {
    return new Promise(async (resolve, reject) => {
      const streamType = _streamType || "all";

      // We don't fetch schema while fetching all streams or specific type all streams
      // So keeping it false, don't change this
      schema = false;
      if (getStreamsPromise.value) {
        await getStreamsPromise.value;
      }
      try {
        // Added adddtional check to fetch all streamstype separately if streamName is all
        const dismiss = notify
          ? q.notify({
              spinner: true,
              message: "Please wait while loading streams...",
              timeout: 5000,
            })
          : () => {};

        getStreamsPromise.value = StreamService.nameList(
          store.state.selectedOrganization.identifier,
          _streamType,
          schema,
          offset,
          limit,
          keyword,
          sort,
          asc,
        );
        getStreamsPromise.value
          .then((res: any) => {
            const streamData = {
              name: streamType,
              list: res.data.list,
              schema: false,
              total: res.data.total,
            };
            getStreamsPromise.value = null;
            dismiss();
            resolve(streamData);
          })
          .catch((e: any) => {
            getStreamsPromise.value = null;
            dismiss();
            reject(new Error(e.message));
          });
      } catch (e: any) {
        reject(new Error(e.message));
      }
    });
  };

  const getAllStreamsPayload = () => {
    const streamObject = getStreamPayload();
    streamObject.name = "all";
    streamObject.schema = false;

    Object.keys(streamsCache).forEach((key) => {
      streamObject.list.push(...(streamsCache[key].value?.list || []));
    });

    return streamObject;
  };

  const getStream = async (
    streamName: string,
    streamType: string,
    schema: boolean,
    force: boolean = false,
  ): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      if (!streamName || !streamType) {
        resolve(null);
      }

      // Wait for the streams to be fetched if they are being fetched
      if (getStreamsPromise.value) {
        await getStreamsPromise.value;
      }

      // If the stream is not fetched, and trying to fetch the specific stream. First fetch all streams
      if (!isStreamFetched(streamType)) {
        try {
          await getStreams(streamType, false);
        } catch (e: any) {
          reject(new Error(e.message));
        }
      }

      try {
        if (
          streamsCache[streamType].value &&
          streamsCache[streamType].value?.list?.length &&
          Object.prototype.hasOwnProperty.call(
            store.state.streams.streamsIndexMapping[streamType],
            streamName,
          )
        ) {
          const streamIndex =
            store.state.streams.streamsIndexMapping[streamType][streamName];
          const hasSchema =
            !!streamsCache[streamType].value?.list[streamIndex]?.schema?.length;

          if ((schema && !hasSchema) || force) {
            try {
              const _stream: any = await StreamService.schema(
                store.state.selectedOrganization.identifier,
                streamName,
                streamType,
              );
              const streamList = deepCopy(streamsCache[streamType].value || {});
              streamList.list[streamIndex] = removeSchemaFields(_stream.data);
              updateStreamsInStore(streamType, streamList);
            } catch (err: any) {
              return reject(new Error(`Error while fetching schema: ${err?.message || 'Unknown error'}`));
            }
          }
          return resolve(
            streamsCache[streamType].value?.list[streamIndex] || {},
          );
        } else {
          // Stream not found in cache - reject with proper Error object
          // await StreamService.schema(
          //   store.state.selectedOrganization.identifier,
          //   streamName,
          //   streamType
          // )
          //   .then((res: any) => {
          //     addStream(res.data);
          //     const streamIndex = streamsIndexMapping[streamType][streamName];
          //     return resolve(streams[streamType].list[streamIndex]);
          //   })
          //   .catch(() => reject(new Error("Stream Not Found")));
          return reject(new Error(`Stream '${streamName}' not found for type '${streamType}'`));
        }
      } catch (e: any) {
        reject(new Error(e.message));
      }
    });
  };

  const getMultiStreams = async (
    _streams: Array<{
      streamName: string;
      streamType: string;
      schema: boolean;
    }>,
  ): Promise<any[]> => {
    return Promise.all(
      _streams.map(async ({ streamName, streamType, schema }) => {
        // Return null immediately if either streamName or streamType is not provided.
        if (!streamName || !streamType) {
          return null;
        }

        try {
          // Check if the stream exists and has been indexed.
          if (
            streamsCache[streamType].value &&
            streamsCache[streamType].value?.list.length &&
            Object.prototype.hasOwnProperty.call(
              store.state.streams.streamsIndexMapping[streamType],
              streamName,
            )
          ) {
            const streamIndex =
              store.state.streams.streamsIndexMapping[streamType][streamName];
            const hasSchema =
              !!streamsCache[streamType].value?.list[streamIndex]?.schema;

            // If schema is requested but not present, fetch and update it.
            if (schema && !hasSchema) {
              const fetchedStream = await StreamService.schema(
                store.state.selectedOrganization.identifier,
                streamName,
                streamType,
              );

              const streamList = deepCopy(streamsCache[streamType].value || {});
              streamList.list[streamIndex] = removeSchemaFields(
                fetchedStream.data,
              );
              updateStreamsInStore(streamType, streamList);
            }
          }

          // Return the stream object (with or without updated schema).
          const streamIndex =
            store.state.streams.streamsIndexMapping[streamType][streamName];
          return streamsCache[streamType].value?.list?.[streamIndex] || {};
        } catch (e: any) {
          // Use reject in Promise.all to catch errors specifically.
          throw new Error(e.message);
        }
      }),
    );
  };

  function removeSchemaFields(streamData: any) {
    if (streamData.schema) {
      streamData.schema = streamData.schema.filter((field: any) => {
        return (
          field.name != "_o2_id" &&
          field.name != "_original" &&
          field.name != "_all_values"
        );
      });
    }
    return streamData;
  }

  const isStreamFetched = (streamType: string) => {
    let isStreamFetched = false;
    if (streamType === "all") {
      isStreamFetched = store.state.streams.areAllStreamsFetched;
    } else {
      isStreamFetched = !!streamsCache[streamType]?.value?.list;
    }

    return isStreamFetched;
  };

  const setStreams = (
    streamName: string = "all",
    streamList: any[] = [],
    force: boolean = false,
  ) => {
    if (isStreamFetched(streamName || "all") && !force) return;

    if (!store.state.organizationData.isDataIngested && !!streamList.length)
      store.dispatch("setIsDataIngested", !!streamList.length);

    const streamObject = getStreamPayload();
    streamObject.name = streamName;
    streamObject.list = streamList;
    streamObject.schema = false;

    // If the stream name is all, then we need to store each type of stream separately manually
    if (streamName === "all") {
      Object.keys(streamsCache).forEach((key) => {
        updateStreamsInStore(key, {});
      });

      streamList.forEach((stream: any) => {
        if (streamsCache[stream.stream_type].value) {
          const streamList = deepCopy(
            streamsCache[stream.stream_type].value || {},
          );
          streamList.list.push(stream);
          updateStreamsInStore(stream.stream_type, streamList);
        } else {
          updateStreamsInStore(stream.stream_type, {
            name: stream.stream_type,
            list: [stream],
            schema: false,
          });
        }
      });
    } else {
      updateStreamsInStore(streamName, deepCopy(streamObject));
    }

    // Mapping stream index for each stream type
    if (streamName === "all") {
      updateStreamIndexMappingInStore({});
      Object.keys(streamsCache).forEach((key) => {
        const streamIndexMapping = deepCopy(
          store.state.streams.streamsIndexMapping || {},
        );
        streamIndexMapping[key] = {};

        streamsCache[key].value?.list?.forEach((stream: any, index: number) => {
          streamIndexMapping[key][stream.name] = index;
        });
        updateStreamIndexMappingInStore(streamIndexMapping || {});
      });
    } else {
      const streamIndexMapping = deepCopy(
        store.state.streams.streamsIndexMapping || {},
      );
      streamIndexMapping[streamName] = {};
      streamsCache[streamName].value?.list?.forEach(
        (stream: any, index: number) => {
          streamIndexMapping[streamName][stream.name] = index;
        },
      );
      updateStreamIndexMappingInStore(streamIndexMapping);
    }

    return streamObject;
  };

  const getStreamPayload = () => {
    return {
      name: "",
      list: [],
      schema: false,
    } as {
      name: string;
      list: any;
      schema: boolean;
    };
  };

  // Don't add delete log here, it will create issue
  // This method is to remove specific stream from cache
  const removeStream = (streamName: string, streamType: string) => {
    if (
      Object.prototype.hasOwnProperty.call(
        store.state.streams.streamsIndexMapping[streamType],
        streamName,
      )
    ) {
      const indexToRemove =
        store.state.streams.streamsIndexMapping[streamType][streamName];

      // Deleting stream index that was mapped
      delete store.state.streams.streamsIndexMapping[streamType][streamName];

      // TODO OK : Remove the multiple updates to store
      if (
        indexToRemove >= 0 &&
        indexToRemove < streamsCache[streamType].value?.list?.length
      ) {
        for (
          let i = indexToRemove;
          i < streamsCache[streamType].value?.list?.length - 1;
          i++
        ) {
          // Shift each element one position to the left
          const streamList = deepCopy(
            streamsCache[streamType].value?.list || [],
          );
          streamList[i] = streamList[i + 1];

          const streamIndexMapping = deepCopy(
            store.state.streams.streamsIndexMapping || {},
          );
          streamIndexMapping[streamType][streamList[i].name] = i;

          updateStreamIndexMappingInStore(streamIndexMapping);
        }
        // Remove the last element since it's now duplicated
        const streamList = deepCopy(streamsCache[streamType].value || {});
        streamList.list.length = streamList.list.length - 1;
        updateStreamsInStore(streamType, streamList);
      }
    }
  };

  const addStream = async (stream: any) => {
    if (
      !!streamsCache[stream.stream_type] &&
      store.state.streams.streamsIndexMapping[stream.stream_type][
        stream.name
      ] >= 0
    )
      return;

    // If that stream type is not present create that stream
    if (!streamsCache[stream.stream_type]) {
      getStream(stream.name, stream.stream_type, true);
    } else {
      const streamList = deepCopy(streamsCache[stream.stream_type].value || {});
      streamList.list.push(stream);

      const streamIndexMapping = deepCopy(
        store.state.streams.streamsIndexMapping,
      );
      streamIndexMapping[stream.stream_type][stream.name] =
        streamList.list.length - 1;

      updateStreamIndexMappingInStore(streamIndexMapping);
      updateStreamsInStore(stream.stream_type, streamList);
    }
  };

  const resetStreams = () => {
    Object.keys(streamsCache).forEach((key) => {
      updateStreamsInStore(key, null);
    });
    updateStreamIndexMappingInStore({});
    updateStreamsFetchedInStore(false);
    getStreamsPromise.value = null;
    store.dispatch("setIsDataIngested", false);
  };

  function compareArrays(previousArray: any, currentArray: any) {
    const add = [];
    const remove = [];

    // Convert previousArray into a map for easy lookup
    const previousMap = new Map();
    for (const key in previousArray) {
      const prevItem = previousArray[key];
      previousMap.set(prevItem.field, prevItem);
    }

    // Convert currentArray into a map for easy lookup
    const currentMap = new Map();
    for (const currentItem of currentArray) {
      currentMap.set(currentItem.field, currentItem);
    }

    // Check for items in currentArray that are not in previousArray
    for (const currentItem of currentArray) {
      const prevItem = previousMap.get(currentItem.field);
      if (!prevItem || !deepEqual(currentItem, prevItem)) {
        add.push(currentItem);
      }
    }

    // Check for items in previousArray that are not in currentArray
    for (const [field, prevItem] of previousMap) {
      const currentItem = currentMap.get(field);
      if (!currentItem || !deepEqual(prevItem, currentItem)) {
        remove.push(prevItem);
      }
    }

    return { add, remove };
  }

  // Helper function to deeply compare two objects, considering the "types" object and ignoring the "disabled" attribute
  function deepEqual(objA: any, objB: any) {
    if (
      typeof objA !== "object" ||
      typeof objB !== "object" ||
      objA === null ||
      objB === null
    ) {
      return objA === objB;
    }

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (typeof objA[key] === "object" && typeof objB[key] === "object") {
        if (!deepEqual(objA[key], objB[key])) return false;
      } else if (objA[key] !== objB[key]) {
        return false;
      }
    }

    return true;
  }

  const getUpdatedSettings = (previousSettings: any, currentSettings: any) => {
    const attributesToCompare: Array<string> = [
      "fields",
      "partition_keys",
      "index_fields",
      "full_text_search_keys",
      "bloom_filter_fields",
      "defined_schema_fields",
      "extended_retention_days",
      "pattern_associations",
    ];

    let updatedSettings: any = {};
    updatedSettings = { ...currentSettings };

    attributesToCompare.forEach((attribute) => {
      const previousArray =
        Array.isArray(previousSettings[attribute]) ||
        typeof previousSettings[attribute] === "object"
          ? previousSettings[attribute]
          : [];
      const currentArray =
        Array.isArray(currentSettings[attribute]) ||
        typeof currentSettings[attribute] === "object"
          ? currentSettings[attribute]
          : [];

      let add: any[] = [];
      let remove: any[] = [];

      if (
        attribute === "partition_keys" &&
        typeof previousArray === "object" &&
        typeof currentArray === "object"
      ) {
        const result: any = compareArrays(previousArray, currentArray);
        add = result.add;
        remove = result.remove;
        remove = remove.filter((item: any) => {
          const isInAdd = add.some(
            (addItem: any) => addItem.field === item.field,
          );

          // Only keep in `remove` if not in `add` and `disabled` is false
          return !isInAdd && item.disabled === false;
        });
      } else if (attribute === "extended_retention_days") {
        add = currentArray.filter(
          (currentItem: any) =>
            !previousArray.some(
              (previousItem: any) =>
                JSON.stringify(currentItem) === JSON.stringify(previousItem),
            ),
        );
        remove = previousArray.filter(
          (previousItem: any) =>
            !currentArray.some(
              (currentItem: any) =>
                JSON.stringify(previousItem) === JSON.stringify(currentItem),
            ),
        );
      } else if (attribute === "pattern_associations") {
        const result: any = comparePatternAssociations(
          previousArray,
          currentArray,
        );
        add = result.add;
        remove = result.remove;
      } else {
        // For other attributes, do a simple array comparison
        add = currentArray.filter((item: any) => !previousArray.includes(item));
        remove = previousArray.filter(
          (item: any) => !currentArray.includes(item),
        );
      }

      // Add the _add and _remove arrays to the result
      updatedSettings[`${attribute}`] = { add: add, remove: remove };
    });

    return updatedSettings;
  };

  const resetStreamType = (streamType: string = "") => {
    try {
      if (streamType != "" && Object.hasOwn(streamsCache, streamType)) {
        updateStreamsInStore(streamType, {});
      }
    } catch (e) {
      console.log("Error while clearing local cache for stream type.", e);
    }
  };
  //ths is the type of the pattern associations
  //this is used to compare the pattern associations in the settings
  type Pattern = {
    field: string;
    pattern_name: string;
    pattern_id: string;
    policy: string;
    apply_at?: string | null; // Optional or nullable
    pattern: string;
    description?: string;
  };

  //this function is used to compare the pattern associations
  //so we compare array of objects and check if the pattern_id and field are same why both -> sometimes we are getting same pattern_id but different field
  //if they are same then we consider them as same
  //otherwise we consider them as different
  //this is used to compare the pattern associations in the settings
  const comparePatternAssociations = (prev: Pattern[], curr: Pattern[]) => {
    const isSame = (a: Pattern, b: Pattern) => {
      // If apply_at is undefined/null in either object, consider them the same
      //because some times user might not select the apply_at value while updating the already applied pattern
      //so instead of sending undefined/null we dont consider them as different
      if (!a.apply_at || !b.apply_at) {
        return (
          a.pattern_id === b.pattern_id &&
          a.field === b.field &&
          a.policy === b.policy
        );
      }
      return (
        a.pattern_id === b.pattern_id &&
        a.field === b.field &&
        a.policy === b.policy &&
        a.apply_at === b.apply_at
      );
    };

    const add = curr.filter(
      (currItem) => !prev.some((prevItem) => isSame(currItem, prevItem)),
    );

    const remove = prev.filter(
      (prevItem) => !curr.some((currItem) => isSame(currItem, prevItem)),
    );

    return { add, remove };
  };

  const isStreamExists = (streamName: string, streamType: string) => {
    try {
      // Check if the required objects exist before accessing them
      if (!store.state?.streams?.streamsIndexMapping?.[streamType]) {
        return false;
      }

      return Object.prototype.hasOwnProperty.call(
        store.state.streams.streamsIndexMapping[streamType],
        streamName,
      );
    } catch (error) {
      console.warn("Error checking if stream exists:", error);
      return false;
    }
  };

  const addNewStreams = (streamType: string, streamList: any[]) => {
    // Check if stream exist in store, if not then add it
    const streamsToAdd = [...(streamsCache[streamType].value?.list || [])];

    streamList.forEach((stream) => {
      if (!isStreamExists(stream.name, streamType)) {
        streamsToAdd.push(stream);
      }
    });

    if (streamsToAdd.length > 0) {
      setStreams(streamType, streamsToAdd, true);
    }
  };

  return {
    getStreams,
    getStream,
    setStreams,
    getMultiStreams,
    resetStreams,
    removeStream,
    addStream,
    getUpdatedSettings,
    resetStreamType,
    getPaginatedStreams,
    isStreamExists,
    isStreamFetched,
    addNewStreams,
    // Internal functions exposed for testing
    updateStreamsInStore,
    updateStreamIndexMappingInStore,
    updateStreamsFetchedInStore,
    getAllStreamsPayload,
    removeSchemaFields,
    getStreamPayload,
    compareArrays,
    deepEqual,
    comparePatternAssociations,
  };
};

export default useStreams;
