import http from "./http";

const destination = {
  create: ({ org_identifier, destination_name, data }: any) => {
    return http().post(
      `/api/${org_identifier}/alerts/destinations/${destination_name}`,
      data
    );
  },
  list: ({ org_identifier }: any) => {
    return http().get(`/api/${org_identifier}/alerts/destinations`);
  },
  get_by_name: ({ org_identifier, destination_name }: any) => {
    return http().get(
      `/api/${org_identifier}/alerts/destinations/${destination_name}`
    );
  },
  delete: ({ org_identifier, destination_name }: any) => {
    return http().delete(
      `/api/${org_identifier}/alerts/destinations/${destination_name}`
    );
  },
};

export default destination;
