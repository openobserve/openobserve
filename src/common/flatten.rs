use ahash::AHashMap;
use json::Value;

use super::json;
use super::json::flatten_json_and_format_field;
use crate::meta::functions::StreamTransform;
use crate::meta::functions::VRLRuntimeConfig;
use crate::meta::ingestion::StreamStatus;
use crate::service::ingestion::apply_vrl_fn;
use crate::service::logs::json::handle_ts;

#[inline(always)]
pub fn flatten_req(
    mut req_data: Vec<json::Value>,
    stream_status: &mut StreamStatus,
    local_trans: &Vec<StreamTransform>,
    stream_vrl_map: &AHashMap<String, VRLRuntimeConfig>,
    stream_name: &str,
) -> Result<Vec<json::Value>, anyhow::Error> {
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let is_local_trans_empty = local_trans.is_empty();

    for _value in &mut req_data {
        let mut value = std::mem::replace(_value, Value::Null);

        if !is_local_trans_empty {
            value = flatten_json_and_format_field(&value);
            for trans in local_trans {
                let func_key = format!("{stream_name}/{}", trans.transform.name);
                if let Some(vrl_runtime) = stream_vrl_map.get(&func_key) {
                    if !value.is_null() {
                        value = apply_vrl_fn(&mut runtime, vrl_runtime, &value);
                    }
                }
            }
        }
        value = flatten_json_and_format_field(&value);
        let mut map = value.as_object().unwrap().clone();
        handle_ts(&mut map, stream_status);
        *_value = Value::Object(map);
    }
    Ok(req_data)
}
