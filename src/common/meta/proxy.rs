use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct QueryParamProxyURL {
    #[serde(alias = "proxy-token")]
    pub proxy_token: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PathParamProxyURL {
    pub target_url: String,
    pub org_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_param_proxy_url() {
        let proxy_url = QueryParamProxyURL {
            proxy_token: "test-token".to_string(),
        };

        assert_eq!(proxy_url.proxy_token, "test-token");
    }

    #[test]
    fn test_query_param_proxy_url_default() {
        let proxy_url = QueryParamProxyURL::default();
        assert_eq!(proxy_url.proxy_token, "");
    }

    #[test]
    fn test_query_param_proxy_url_serialization() {
        let proxy_url = QueryParamProxyURL {
            proxy_token: "test-token".to_string(),
        };

        let serialized = serde_json::to_string(&proxy_url).unwrap();
        let deserialized: QueryParamProxyURL = serde_json::from_str(&serialized).unwrap();

        assert_eq!(proxy_url, deserialized);
    }

    #[test]
    fn test_query_param_proxy_url_alias() {
        let json = r#"{"proxy-token": "test-token"}"#;
        let proxy_url: QueryParamProxyURL = serde_json::from_str(json).unwrap();
        assert_eq!(proxy_url.proxy_token, "test-token");
    }

    #[test]
    fn test_path_param_proxy_url() {
        let proxy_url = PathParamProxyURL {
            target_url: "http://example.com".to_string(),
            org_id: "org123".to_string(),
        };

        assert_eq!(proxy_url.target_url, "http://example.com");
        assert_eq!(proxy_url.org_id, "org123");
    }

    #[test]
    fn test_path_param_proxy_url_default() {
        let proxy_url = PathParamProxyURL::default();
        assert_eq!(proxy_url.target_url, "");
        assert_eq!(proxy_url.org_id, "");
    }

    #[test]
    fn test_path_param_proxy_url_serialization() {
        let proxy_url = PathParamProxyURL {
            target_url: "http://example.com".to_string(),
            org_id: "org123".to_string(),
        };

        let serialized = serde_json::to_string(&proxy_url).unwrap();
        let deserialized: PathParamProxyURL = serde_json::from_str(&serialized).unwrap();

        assert_eq!(proxy_url, deserialized);
    }

    #[test]
    fn test_path_param_proxy_url_equality() {
        let url1 = PathParamProxyURL {
            target_url: "http://example.com".to_string(),
            org_id: "org123".to_string(),
        };

        let url2 = PathParamProxyURL {
            target_url: "http://example.com".to_string(),
            org_id: "org123".to_string(),
        };

        let url3 = PathParamProxyURL {
            target_url: "http://different.com".to_string(),
            org_id: "org123".to_string(),
        };

        assert_eq!(url1, url2);
        assert_ne!(url1, url3);
    }
}
