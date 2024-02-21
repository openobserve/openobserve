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

let streams: any = reactive({});

let streamsIndexMapping: any = reactive({
  logs: {
    stream1: 0,
  },
});

const useStreams = () => {
  const store = useStore();

  const getStreams = async (_streamName: string = "", schema: boolean) => {
    const streamName = _streamName || "all";

    // We don't fetch schema while fetching all streams or specific type all streams
    // So keeping it false, don't change this
    schema = false;

    let isStreamFetched = false;
    if (streamName === "all") {
      isStreamFetched =
        streams["logs"] &&
        streams["metrics"] &&
        streams["traces"] &&
        streams["enrichment_tables"];
    } else {
      isStreamFetched = !!streams[streamName];
    }

    try {
      if (!isStreamFetched) {
        return await StreamService.nameList(
          store.state.selectedOrganization.identifier,
          _streamName,
          schema
        )
          .then((res: any) => {
            if (
              !store.state.organizationData.isDataIngested &&
              !!res.data.list.length
            )
              store.dispatch("setIsDataIngested", !!res.data.list.length);

            const streamObject = getStreamPayload();
            streamObject.name = streamName;
            streamObject.list = res.data.list;
            streamObject.schema = schema;

            // If the stream name is all, then we need to store each type of stream separately manually
            if (streamName === "all") {
              const streams: {
                [key: string]: {
                  name: string;
                  list: any;
                  schema: boolean;
                };
              } = {};

              res.data.list.forEach((stream: any) => {
                if (streams[stream.stream_type]) {
                  streams[stream.stream_type].list.push(stream);
                } else {
                  streams[stream.stream_type] = {
                    name: stream.stream_type,
                    list: [stream],
                    schema: schema,
                  };
                }
              });

              Object.values(streams).forEach((stream: any) => {
                streams[stream.name] = stream;
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
                  streamsIndexMapping[stream.name] = index;
                });
              });
            } else {
              streamsIndexMapping[streamName] = {};
              streams[streamName].list.forEach((stream: any, index: number) => {
                streamsIndexMapping[streamName][stream.name] = index;
              });
            }

            return streamObject;
          })
          .catch((e: any) => {
            throw new Error(e.message);
          });
      } else {
        if (streamName === "all") {
          const streamObject = getStreamPayload();
          streamObject.name = streamName;
          streamObject.schema = schema;

          const keys = [
            "logs",
            "metrics",
            "traces",
            "enrichment_tables",
            "metadata",
          ];
          keys.forEach((key) => {
            streamObject.list.push(...streams[key].list);
          });
        } else {
          return streams[streamName];
        }
      }
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  const getStream = async (
    streamName: string,
    streamType: string,
    schema: boolean
  ): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      if (!streamName || !streamType) {
        resolve(null);
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
          const hasSchema =
            !!streams[streamType].list[
              streamsIndexMapping[streamType][streamName]
            ]?.schema;

          if (schema && !hasSchema) {
            const _stream: any = await StreamService.schema(
              store.state.selectedOrganization.identifier,
              streamName,
              streamType
            );
            streams[streamType].list[
              streamsIndexMapping[streamType][streamName]
            ] = _stream.data;
          }
        }
        return resolve(
          streams[streamType].list[streamsIndexMapping[streamType][streamName]]
        );
      } catch (e: any) {
        throw new Error(e.message);
      }
    });
  };

  // const getStream = async (
  //   streamNames: string[{
  //     streamName: string;
  //     streamType: string;
  //     schema:
  //   }],
  //   streamType: string,
  //   schema: boolean
  // ): Promise<any[]> => {
  //   return new Promise(async (resolve, reject) => {
  //     if (!streamNames.length || !streamType) {
  //       resolve([]);
  //     }

  //     const streamData: any[] = [];
  //     let stream = null;
  //     try {
  //       for (let i = 0; i < streamNames.length; i++) {
  //         if (
  //           streams[streamType] &&
  //           streams[streamType].list.length &&
  //           Object.prototype.hasOwnProperty.call(
  //             streamsIndexMapping[streamType],
  //             streamNames[i]
  //           )
  //         ) {
  //           stream =
  //             streams[streamType].list[
  //               streamsIndexMapping[streamType][streamNames[i]]
  //             ];
  //           if (schema && !stream.schema) {
  //             let _stream: any = await StreamService.schema(
  //               store.state.selectedOrganization.identifier,
  //               streamNames[i],
  //               streamType
  //             );
  //             stream = _stream.data;
  //             _stream = null;
  //           }

  //           streamData.push(cloneDeep(stream));
  //         }
  //       }
  //       return resolve(streamData);
  //     } catch (e: any) {
  //       throw new Error(e.message);
  //     }
  //   });
  // };

  const setStreams = (streamName: string = "all", streamList: any[] = []) => {
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
          streamsIndexMapping[stream.name] = index;
        });
      });
    } else {
      streamsIndexMapping[streamName] = {};
      streams[streamName].list.forEach((stream: any, index: number) => {
        streamsIndexMapping[streamName][stream.name] = index;
      });
    }
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
  return { getStreams, getStream, setStreams };
};

export default useStreams;
