interface Group {}

interface User {}

interface Permission {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

interface Role {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  permissions?: Array<Permission>;
}

interface Roles {}
