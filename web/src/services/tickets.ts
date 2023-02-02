/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const tickets = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/tickets?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  update: (ticketId: number, data: any) => {
    return http().put(`/api/tickets/${ticketId}`, data);
  },
  create: (data: any) => {
    return http().post("/api/tickets", data);
  },
  delete: (names: string) => {
    return http().delete("/api/tickets/" + names);
  },
};

export default tickets;
