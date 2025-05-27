import http from "./http";

const common = {
  list_Folders: (organization: string, folder_type: string) => {
    return http().get(`/api/v2/${organization}/folders/${folder_type}`);
  },
  new_Folder: (organization: string, folder_type: string, data: any) => {
    return http().post(`/api/v2/${organization}/folders/${folder_type}`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  edit_Folder: (organization: string, folder_type: string, folderId: any, data: any) => {
    return http().put(`/api/v2/${organization}/folders/${folder_type}/${folderId}`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  delete_Folder: (organization: string, folder_type: string, folderId: any) => {
    return http().delete(`/api/v2/${organization}/folders/${folder_type}/${folderId}`);
  },
  get_Folder: (organization: string, folder_type: string, folderId: any) => {
    return http().get(`/api/v2/${organization}/folders/${folder_type}/${folderId}`);
  },
  move_across_folders: (organization: string, type: string, data: any,folder_id?: any) => {
    let url = `/api/v2/${organization}/${type}/move`;
    if(folder_id){
      url += `?folder=${folder_id}`;
    }
    return http().patch(url, data);
  },
  list_nodes: (organization: string) => {
    const url = `/api/${organization}/node/list`;
    return http().get(url);
  }
};

export default common;