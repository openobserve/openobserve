use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transform {
    #[serde(default)]
    #[serde(skip_serializing_if = "is_zero")]
    pub order: u32,
    pub function: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub stream_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub num_args: u8,
    #[serde(default)]
    pub trans_type: u8,
}
fn is_zero(b: impl std::borrow::Borrow<u32>) -> bool {
    b.borrow() <= &0
}

impl PartialEq for Transform {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.stream_name == other.stream_name
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransformList {
    pub list: Vec<Transform>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tarsnform() {
        let trns = Transform {
            order: 0,
            function: "function jsconcat(a,b){return a+b}".to_string(),
            stream_name: "olympics".to_string(),
            name: "jsconcat".to_string(),
            num_args: 2,
            trans_type: 1,
        };

        let mod_trns = Transform {
            order: 0,
            function: "function jsconcat(a,b){return a..b}".to_string(),
            stream_name: "olympics".to_string(),
            name: "jsconcat".to_string(),
            num_args: 2,
            trans_type: 1,
        };

        let trans_list = TransformList { list: vec![] };
        assert_eq!(trns, mod_trns);
        assert!(trans_list.list.is_empty());
    }
}
