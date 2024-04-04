import http from "./http";

const formatPromqlQuery = ({ org_identifier = "", query = "" }) => {
  return http().get(
    `/api/${org_identifier}/prometheus/api/v1/format_query?query=${query}`
  );
};

const get_promql_series = ({
  org_identifier,
  labels,
  start_time,
  end_time,
}: {
  org_identifier: string;
  labels: string;
  start_time: number;
  end_time: number;
}) => {
  const url = `/api/${org_identifier}/prometheus/api/v1/series?match[]=${labels}&start=${start_time}&end=${end_time}`;
  return http().get(url);
};

export default { formatPromqlQuery, get_promql_series };
