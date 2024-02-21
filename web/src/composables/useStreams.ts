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

import { useStore } from "vuex";
import StreamService from "@/services/stream";
import { reactive } from "vue";
import { ref } from "vue";

let streams: any = reactive({});

let streamsIndexMapping: any = reactive({});

const areAllStreamsFetched = ref(false);

const getStreamsPromise: any = ref(null);

const useStreams = () => {
  const store = useStore();

  const getStreams = async (_streamName: string = "", schema: boolean) => {
    return new Promise(async (resolve, reject) => {
      const streamName = _streamName || "all";

      // We don't fetch schema while fetching all streams or specific type all streams
      // So keeping it false, don't change this
      schema = false;

      if (getStreamsPromise.value) {
        await getStreamsPromise.value;
      }

      try {
        if (!isStreamFetched(streamName || "all")) {
          getStreamsPromise.value = StreamService.nameList(
            store.state.selectedOrganization.identifier,
            _streamName,
            schema
          );
          getStreamsPromise.value
            .then((res: any) => {
              const streamData = setStreams(streamName, res.data.list);

              areAllStreamsFetched.value = true;

              resolve(streamData);
            })
            .catch((e: any) => {
              reject(new Error(e.message));
            })
            .finally(() => {
              setTimeout(() => (getStreamsPromise.value = null), 5000);
            });
        } else {
          if (streamName === "all") {
            const streamObject = getStreamPayload();
            streamObject.name = streamName;
            streamObject.schema = schema;

            Object.keys(streams).forEach((key) => {
              streamObject.list.push(...streams[key].list);
            });

            resolve(streamObject);
          } else {
            resolve(streams[streamName]);
          }
        }
      } catch (e: any) {
        reject(new Error(e.message));
      }
    });
  };

  const getStream = async (
    streamName: "",
    streamType: string,
    schema: boolean
  ): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      if (!streamName || !streamType) {
        resolve(null);
      }

      if (getStreamsPromise.value) {
        console.log(getStreamsPromise.value);
        console.log("waiting for promise");
        await getStreamsPromise.value;
        console.log("promise fullfilled");
      }

      try {
        if (
          streams[streamType] &&
          streams[streamType].list.length &&
          Object.prototype.hasOwnProperty.call(
            streamsIndexMapping[streamType],
            streamName
          )
        ) {
          const streamIndex = streamsIndexMapping[streamType][streamName];
          const hasSchema = !!streams[streamType].list[streamIndex]?.schema;

          if (schema && !hasSchema) {
            const _stream: any = await StreamService.schema(
              store.state.selectedOrganization.identifier,
              streamName,
              streamType
            );
            streams[streamType].list[streamIndex] = _stream.data;
          }
          return resolve(streams[streamType].list[streamIndex]);
        } else {
          reject(new Error("Stream not found"));
        }
      } catch (e: any) {
        throw new Error(e.message);
      }
    });
  };

  const getMultiStreams = async (
    _streams: Array<{ streamName: string; streamType: string; schema: boolean }>
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
            streams[streamType] &&
            streams[streamType].list.length &&
            Object.prototype.hasOwnProperty.call(
              streamsIndexMapping[streamType],
              streamName
            )
          ) {
            const streamIndex = streamsIndexMapping[streamType][streamName];
            const hasSchema = !!streams[streamType].list[streamIndex]?.schema;

            // If schema is requested but not present, fetch and update it.
            if (schema && !hasSchema) {
              const fetchedStream = await StreamService.schema(
                store.state.selectedOrganization.identifier,
                streamName,
                streamType
              );

              streams[streamType].list[streamIndex] = fetchedStream.data;
            }
          }

          // Return the stream object (with or without updated schema).
          return streams[streamType]?.list[
            streamsIndexMapping[streamType][streamName]
          ];
        } catch (e: any) {
          // Use reject in Promise.all to catch errors specifically.
          throw new Error(e.message);
        }
      })
    );
  };

  const isStreamFetched = (streamType: string) => {
    let isStreamFetched = false;
    if (streamType === "all") {
      isStreamFetched = areAllStreamsFetched.value;
    } else {
      isStreamFetched = !!streams[streamType];
    }

    return isStreamFetched;
  };

  const setStreams = (streamName: string = "all", streamList: any[] = []) => {
    if (isStreamFetched(streamName || "all")) return;

    if (!store.state.organizationData.isDataIngested && !!streamList.length)
      store.dispatch("setIsDataIngested", !!streamList.length);

    const streamObject = getStreamPayload();
    streamObject.name = streamName;
    streamObject.list = streamList;
    streamObject.schema = false;

    // If the stream name is all, then we need to store each type of stream separately manually
    if (streamName === "all") {
      streams = reactive({});

      streamList.forEach((stream: any) => {
        if (streams[stream.stream_type]) {
          streams[stream.stream_type].list.push(stream);
        } else {
          streams[stream.stream_type] = {
            name: stream.stream_type,
            list: [stream],
            schema: false,
          };
        }
      });
    } else {
      streams[streamName] = streamObject;
    }

    // Mapping stream index for each stream type
    if (streamName === "all") {
      streamsIndexMapping = reactive({});
      Object.keys(streams).forEach((key) => {
        streamsIndexMapping[key] = {};
        streams[key].list.forEach((stream: any, index: number) => {
          streamsIndexMapping[key][stream.name] = index;
        });
      });
    } else {
      streamsIndexMapping[streamName] = {};
      streams[streamName].list.forEach((stream: any, index: number) => {
        streamsIndexMapping[streamName][stream.name] = index;
      });
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

  const resetStreams = () => {
    streams = reactive({});
    streamsIndexMapping = reactive({});
    areAllStreamsFetched.value = false;
    getStreamsPromise.value = null;
  };

  return { getStreams, getStream, setStreams, getMultiStreams, resetStreams };
};

export default useStreams;
