export const config = {
 userPoolsId : import.meta.env.VITE_USER_POOLS_ID,
 webClientId : import.meta.env.VITE_WEB_CLIENT_ID,
 oAuthDomain : import.meta.env.VITE_OAUTH_DOMAIN,
 redirectSignIn: import.meta.env.VITE_REDIRECT_SIGNIN,
 redirectSignOut: import.meta.env.VITE_REDIRECT_SIGNOUT,
 responseType: "CODE",
 scope: "",
};
