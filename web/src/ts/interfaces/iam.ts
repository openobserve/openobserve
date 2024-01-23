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

interface User {}
