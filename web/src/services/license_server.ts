import http from "./http";

const licenseServer = {
  get_license: () => {
    const url = `/api/license`;
    return http().get(url);
  },
  update_license: (licenseKey: string) => {
    const url = `/api/license`;
    return http().post(url, { key: licenseKey });
  },
  refresh_license_limits: () => {
    const url = `/api/license/refresh`;
    return http().post(url, {});
  },
};

export default licenseServer;
