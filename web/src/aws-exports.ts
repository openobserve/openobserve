const config = {
  aws_cognito_region: import.meta.env.VITE_COGNITO_REGION,
  aws_user_pools_id: import.meta.env.VITE_USER_POOLS_ID,
  aws_user_pools_web_client_id: import.meta.env.VITE_WEB_CLIENT_ID,
  aws_cognito_identity_pool_id:
    "us-west-2:c7bddace-7a1a-478e-87e7-a36e8d0db231",
  aws_mobile_analytics_app_id: "ab7e9321f83c45a8967ff3b9bd90e83a",
  aws_mobile_analytics_app_region: "us-west-2",
  oauth: {
    domain: import.meta.env.VITE_OAUTH_DOMAIN,
    scope: [],
    redirectSignIn: import.meta.env.VITE_REDIRECT_SIGNIN,
    redirectSignOut: import.meta.env.VITE_REDIRECT_SIGNOUT,
    responseType: "CODE",
  },

  openReplayKey: import.meta.env.VITE_OPENREPLAY_KEY,
  sentryDSN: import.meta.env.VITE_SENTRY_DSN,
  zincOxideEndPoint: import.meta.env.VITE_ZINC_OXIDE_ENDPOINT,
  zincOxideIngestion: import.meta.env.VITE_ZINC_OXIDE_INGESTION,
  zincQuotaThreshold: import.meta.env.VITE_ZINC_QUOTA_THRESHOLD,
  enableAnalytics: import.meta.env.VITE_ZINC_ANALYTICS_ENABLED,
  isZincObserveCloud: import.meta.env.VITE_ZINC_OBSERVE_CLOUD,
};

export default config;
