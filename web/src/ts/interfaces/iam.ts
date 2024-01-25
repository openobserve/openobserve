export interface Group {
  group_name: string;
  users: User[];
  roles: Role[];
}

type PermissionType =
  | "AllowAll"
  | "AllowDelete"
  | "AllowGet"
  | "AllowList"
  | "AllowPost"
  | "AllowPut"
  | "None";

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
    AllowAll: boolean | null;
    AllowList: boolean | null;
    AllowGet: boolean | null;
    AllowDelete: boolean | null;
    AllowPost: boolean | null;
    AllowPut: boolean | null;
  };
  type: "resource";
  resourceName: string;
  isSelected: boolean;
  entities: Entity[];
}

export interface Entity {
  name: string;
  permission: {
    AllowAll: boolean | null;
    AllowGet: boolean | null;
    AllowDelete: boolean | null;
    AllowPut: boolean | null;
  };
  type: "entity";
  resourceName: string;
  isSelected: boolean;
}

interface User {}
