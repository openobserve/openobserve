import http from "./http";
import axios from "axios";

var attachments = {
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
  getPresignedUrl: (objectkey: string, fileType: String) => {
    return http().get(
      `/api/attachements/` + objectkey + "?fileType=" + fileType
    );
  },
  upload: (url: string, data: any) => {
    return axios.put(url, data, {
      headers: {
        "Content-Type": data.type,
      },
    });
  },
  create: (data: any) => {
    return http().post("/api/tickets", data);
  },
  delete: (names: string) => {
    return http().delete("/api/tickets/" + names);
  },
};

export default attachments;
