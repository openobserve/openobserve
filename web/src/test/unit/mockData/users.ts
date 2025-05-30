// Copyright 2023 OpenObserve Inc.
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

export default {
  org_users: {
    data: [
      {
        id: 1,
        email: "john@gmail.com",
        cognito_sub: "NA",
        created_at: 1678089178215,
        member_created: 1678089178225,
        member_updated: 1678089178,
        role: "admin",
        org_member_id: 210,
        first_name: "John",
        last_name: "Doe",
      },
      {
        id: 2,
        email: "example@gmail.com",
        cognito_sub: "NA",
        created_at: 1678089178215,
        member_created: 1678089178225,
        member_updated: 1678089178,
        role: "admin",
        org_member_id: 211,
        first_name: "example",
      },
      {
        id: 3,
        email: "test@gmail.com",
        cognito_sub: "NA",
        created_at: 1678089178215,
        member_created: 1678089178225,
        member_updated: 1678089178,
        role: "member",
        org_member_id: 212,
        first_name: "test",
      },
    ],
  },
  users: {
    data: [
      {
        id: 11,
        email: "root@example.com",
        first_name: "root",
        last_name: "",
        role: "root",
      },
      {
        id: 1,
        email: "john@gmail.com",
        role: "admin",
        first_name: "John",
        last_name: "Doe",
      },
      {
        id: 2,
        email: "example@gmail.com",
        role: "admin",
        first_name: "example",
      },
      {
        id: 3,
        email: "test@gmail.com",
        role: "member",
        first_name: "test",
      },
    ],
  },
};
