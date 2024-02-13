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

import { useQuasar } from "quasar";
import { useStore } from "vuex";
import StreamService from "@/services/stream";

const useStreams = () => {
  const store = useStore();
  const $q = useQuasar();

  const getStreams = async (streamName: string, schema: boolean) => {
    try {
      if (
        !store.state.organizationData.streams[streamName || "all"] ||
        (schema &&
          !store.state.organizationData.streams[streamName || "all"].schema)
      ) {
        return await StreamService.nameList(
          store.state.selectedOrganization.identifier,
          streamName,
          schema
        )
          .then((res: any) => {
            if (
              !store.state.organizationData.isDataIngested &&
              !!res.data.list.length
            )
              store.dispatch("setIsDataIngested", !!res.data.list.length);

            const streamObject: {
              name: string;
              list: any;
              schema: boolean;
            } = {
              name: streamName || "all",
              list: res.data.list,
              schema: schema,
            };

            if (!streamName.trim()) {
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

              streams["all"] = {
                name: "all",
                list: [],
                schema: schema,
              };

              Object.values(streams).forEach((stream: any) => {
                store.dispatch("setStreams", stream);
              });
            } else {
              store.dispatch("setStreams", streamObject);
            }
            return streamObject;
          })
          .catch((e: any) => {
            throw new Error(e.message);
          });
      } else {
        if (!streamName.trim()) {
          const allstreams = [
            "logs",
            "metrics",
            "traces",
            "enrichment_table",
            "metadata",
          ];

          const allStreamsData = store.state.organizationData.streams["all"];

          allStreamsData.list = allstreams.reduce(
            (acc: any[], stream: string) => {
              const streamData = store.state.organizationData.streams[stream];
              if (streamData !== undefined) {
                // Check if the stream data exists
                return [...acc, ...streamData.list];
              }
              return acc; // If data is undefined, return the accumulator as is
            },
            []
          );

          console.log("allStreamsData", allStreamsData);
          return allStreamsData;
        } else {
          return store.state.organizationData.streams[streamName];
        }
      }
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getStreams };
};

export default useStreams;
