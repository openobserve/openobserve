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
import TransformService from "@/services/jstransform";

const useFunctions = () => {
  const store = useStore();
  const $q = useQuasar();

  const getAllFunctions = async () => {
    try {
      return await TransformService.list(
        1,
        100000,
        "name",
        false,
        "",
        store.state.selectedOrganization.identifier
      )
        .then((res: any) => {
          store.dispatch("setFunctions", res.data.list);
          return;
        })
        .catch((e: any) => {
          throw new Error(e.message);
        });
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  return { getAllFunctions };
};

export default useFunctions;
