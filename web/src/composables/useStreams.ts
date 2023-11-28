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
