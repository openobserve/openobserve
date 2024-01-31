export interface Group {
  group_name: string;
  users: User[];
  roles: Role[];
}

export type PermissionType =
  | "AllowAll"
  | "AllowDelete"
  | "AllowGet"
  | "AllowList"
  | "AllowPost"
  | "AllowPut";

export interface Permission {
  object: string; // stream:geo or stream:org_id
  permission: PermissionType;
}

export interface Role {
  role_name: string;
  permissions?: Permission[];
}

export interface Resource {
  name: string;
  permission: {
    AllowAll: {
      show: boolean;
      value: boolean | null;
    };
    AllowList: {
      show: boolean;
      value: boolean | null;
    };
    AllowGet: {
      show: boolean;
      value: boolean | null;
    };
    AllowDelete: {
      show: boolean;
      value: boolean | null;
    };
    AllowPost: {
      show: boolean;
      value: boolean | null;
    };
    AllowPut: {
      show: boolean;
      value: boolean | null;
    };
  };
  display_name: string;
  type: "resource";
  resourceName: string;
  isSelected: boolean;
  parent: string;
  childs: Resource[];
  entities: Entity[];
  expand?: boolean;
  slotName?: string;
  has_entities?: boolean;
}

export interface Entity {
  name: string;
  permission: {
    AllowAll: {
      show: boolean;
      value: boolean | null;
    };
    AllowGet: {
      show: boolean;
      value: boolean | null;
    };
    AllowDelete: {
      show: boolean;
      value: boolean | null;
    };
    AllowPut: {
      show: boolean;
      value: boolean | null;
    };
    AllowList: {
      show: boolean;
      value: boolean | null;
    };
  };
  display_name: string;
  entities?: Entity[];
  has_entities?: boolean;
  type: "entity";
  resourceName: string;
  isSelected: boolean;
  expand?: boolean;
}

interface User {}
