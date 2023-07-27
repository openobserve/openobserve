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

import { useQuasar } from "quasar";
import { useStore } from "vuex";
import StreamService from "@/services/stream";

const useStreams = () => {
  const store = useStore();
  const $q = useQuasar();

  const getStreams = async (streamName: string, schema: boolean) => {
    try {
      if (
        store.state.organizationData.streams[streamName] == undefined ||
        (schema != false &&
          store.state.organizationData.streams[streamName].schema != schema)
      ) {
        return await StreamService.nameList(
          store.state.selectedOrganization.identifier,
          streamName,
          schema
        )
          .then((res: any) => {
            const streamObject: {
              name: string;
              list: any;
              schema: boolean;
            } = {
              name: streamName || "all",
              list: res.data.list,
              schema: schema,
            };

            store.dispatch("setStreams", streamObject);
            return streamObject;
          })
          .catch((e: any) => {
            throw new Error(e.message);
          });
      } else {
        return store.state.organizationData.streams[streamName];
      }
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getStreams };
};

export default useStreams;
