import Keys from "../constants/key";
// @ts-ignore
import Cookies from "js-cookie";

export const getSidebarStatus = () => Cookies.get(Keys.sidebarStatusKey);
export const setSidebarStatus = (sidebarStatus: string) =>
  Cookies.set(Keys.sidebarStatusKey, sidebarStatus, { path: "/" });

export const getLanguage = () => Cookies.get(Keys.languageKey);
export const setLanguage = (language: string) =>
  Cookies.set(Keys.languageKey, language, { path: "/" });

export const getSize = () => Cookies.get(Keys.sizeKey);
export const setSize = (size: string) =>
  Cookies.set(Keys.sizeKey, size, { path: "/" });

export const getToken = () => Cookies.get(Keys.tokenKey);
export const setToken = (token: string) =>
  Cookies.set(Keys.tokenKey, token, { path: "/" });
export const removeToken = () => Cookies.remove(Keys.tokenKey);
