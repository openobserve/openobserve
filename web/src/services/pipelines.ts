import { update } from "lodash-es";
import http from "./http";

const pipelines = {
  getPipelines: (org_identifier: string) => {
    const url = `/api/${org_identifier}/pipelines`;
    return http().get(url);
  },

  getPipeline: ({
    name,
    org_identifier,
  }: {
    name: string;
    org_identifier: string;
  }) => {
    const url = `/api/${org_identifier}/pipelines/${name}`;
    return http().get(url);
  },

  deletePipeline: ({
    stream_name,
    stream_type,
    name,
    org_identifier,
  }: {
    stream_name: string;
    name: string;
    stream_type: string;
    org_identifier: string;
  }) => {
    const url = `/api/${org_identifier}/streams/${stream_name}/pipelines/${name}?type=${stream_type}`;
    return http().delete(url);
  },

  createPipeline: ({
    stream_name,
    name,
    stream_type,
    description,
    org_identifier,
  }: {
    stream_name: string;
    stream_type: string;
    name: string;
    org_identifier: string;
    description: string;
  }) => {
    const url = `/api/${org_identifier}/streams/${stream_name}/pipelines?type=${stream_type}`;
    return http({}).post(url, {
      name,
      description,
    });
  },

  updatePipeline: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: any;
  }) => {
    const url = `/api/${org_identifier}/streams/${data.stream_name}/pipelines/${data.name}?type=${data.stream_type}`;
    return http().put(url, data);
  },
};

export default pipelines;
