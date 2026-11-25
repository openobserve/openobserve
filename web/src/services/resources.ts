import http from "./http";
import type { ResourceSearchParams, ResourceSearchResponse } from "@/ts/interfaces/resources";

export default {
  async search(
    org: string,
    params: ResourceSearchParams,
    signal?: AbortSignal,
  ): Promise<ResourceSearchResponse> {
    const response = await http().get<ResourceSearchResponse>(
      `/api/${encodeURIComponent(org)}/resources/_search`,
      {
        params: { ...params, types: params.types?.join(",") },
        signal,
        silentForbidden: true,
      },
    );
    return response.data;
  },
};
