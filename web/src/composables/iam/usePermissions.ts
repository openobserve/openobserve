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

import { reactive } from "vue";
import type { Resource } from "@/ts/interfaces";

const defaultObject = {
  permissions: [
    {
      name: "streams",
      permission: {
        AllowAll: false,
        AllowList: false,
        AllowGet: false,
        AllowDelete: false,
        AllowPost: false,
        AllowPut: false,
      },
      type: "resource",
      resourceName: "streams",
      isSelected: false,
      entities: {},
    },
    {
      name: "functions",
      permission: {
        AllowAll: false,
        AllowList: false,
        AllowGet: false,
        AllowDelete: false,
        AllowPost: false,
        AllowPut: false,
      },
      type: "resource",
      resourceName: "functions",
      isSelected: false,
      entities: {},
    },
    {
      name: "alerts",
      permission: {
        AllowAll: false,
        AllowList: false,
        AllowGet: false,
        AllowDelete: false,
        AllowPost: false,
        AllowPut: false,
      },
      type: "resource",
      resourceName: "alerts",
      isSelected: false,
      entities: {},
    },
  ] as Resource[],
  selectedResources: {},
};

let permissionsState = reactive(Object.assign({}, defaultObject));

const usePermissions = () => {
  const resetPermissionsState = () => {
    // delete searchObj.data;
    permissionsState = reactive(Object.assign({}, defaultObject));
  };

  return { permissionsState, resetPermissionsState };
};

export default usePermissions;
