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
  toggleState: (
    org_identifier: string,
    pipeline_id: string,
    enable: boolean,
    from_now: boolean
  ) => {
    const url = `/api/${org_identifier}/pipelines/${pipeline_id}/enable?value=${enable}&from_now=${from_now}`;
    return http().put(url);
  },
  bulkToggleState: (
    org_identifier: string,
    enable: boolean,
    data: any
  ) => {
    const url = `/api/${org_identifier}/pipelines/bulk/enable?value=${enable}`;
    return http().post(url, data);
  },

  deletePipeline: ({
    pipeline_id,
    org_id,
  }: {
    pipeline_id : string;
    org_id: string;
  }) => {
    const url = `/api/${org_id}/pipelines/${pipeline_id}`;
    return http().delete(url);
  },

  bulkDelete: (
    org_identifier: string,
    data: any
  ) => {
    const url = `/api/${org_identifier}/pipelines/bulk`;
    return http().delete(url, { data });
  },

  createPipeline: ({
    data,
    org_identifier,
  }: {
    data: object;
    org_identifier: string;
  }) => {
    const url = `/api/${org_identifier}/pipelines`;
    return http({}).post(url, data);
  },

  updatePipeline: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: any;
  }) => {
    const url = `/api/${org_identifier}/pipelines`;
    return http().put(url, data);
  },
  getPipelineStreams: (org_identifier:string) => {
    const url = `/api/${org_identifier}/pipelines/streams`;
    return http().get(url);
  },
};

export default pipelines;
