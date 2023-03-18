import http from "./http";

const template = {
  create: ({ org_identifier, template_name, data }: any) => {
    return http().post(
      `/api/${org_identifier}/alerts/templates/${template_name}`,
      data
    );
  },
  list: ({ org_identifier }: any) => {
    return http().get(`/api/${org_identifier}/alerts/templates`);
  },
  get_by_name: ({ org_identifier, template_name }: any) => {
    return http().get(
      `/api/${org_identifier}/alerts/templates/${template_name}`
    );
  },
  delete: ({ org_identifier, template_name }: any) => {
    return http().delete(
      `/api/${org_identifier}/alerts/templates/${template_name}`
    );
  },
};

export default template;
