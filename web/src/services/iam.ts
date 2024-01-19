import http from "./http";

export const createGroup = (group: {
  name: string;
  org_identifier: string;
}) => {
  return http().post("", group);
};

export const updateGroup = (group: {
  name: string;
  org_identifier: string;
}) => {
  return http().post("", group);
};

export const createRole = (group: { name: string; org_identifier: string }) => {
  return http().post("", group);
};

export const updateRole = (group: { name: string; org_identifier: string }) => {
  return http().post("", group);
};
