#[cfg(feature = "zo_functions")]
use crate::infra::config::STREAM_FUNCTIONS;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::Transform;
use ahash::AHashMap;
use arrow_schema::Schema;
#[cfg(feature = "zo_functions")]
use mlua::{Function, Lua, LuaSerdeExt, Value as LuaValue};
use serde_json::Value;

#[cfg(feature = "zo_functions")]
pub fn load_lua_transform(lua: &Lua, js_func: String) -> Function {
    lua.load(&js_func).eval().unwrap()
}
#[cfg(feature = "zo_functions")]
pub fn lua_transform(lua: &Lua, row: &Value, func: &Function) -> Value {
    let input = lua.to_value(&row).unwrap();
    let _res = func.call::<_, LuaValue>(input);
    match _res {
        Ok(res) => lua.from_value(res).unwrap(),
        Err(err) => {
            log::error!("Err from lua {:?}", err.to_string());
            row.clone()
        }
    }
}
#[cfg(feature = "zo_functions")]
pub async fn get_stream_transforms<'a>(
    key: String,
    stream_name: String,
    stream_tansform_map: &mut AHashMap<String, Vec<Transform>>,
    stream_lua_map: &mut AHashMap<String, Function<'a>>,
    lua: &'a Lua,
) {
    if stream_tansform_map.contains_key(&key) {
        return;
    }
    let transforms = STREAM_FUNCTIONS.get(&key);
    if transforms.is_none() {
        return;
    }

    let mut func: Function;
    let mut local_tans: Vec<Transform> = (*transforms.unwrap().list).to_vec();
    local_tans.sort_by(|a, b| a.order.cmp(&b.order));
    for trans in &local_tans {
        let func_key = format!("{}/{}", &stream_name, trans.name);
        func = load_lua_transform(lua, trans.function.clone());
        stream_lua_map.insert(func_key, func.to_owned());
    }
    stream_tansform_map.insert(key, local_tans.clone());
}

pub async fn get_stream_partition_keys(
    stream_name: String,
    stream_schema_map: AHashMap<String, Schema>,
) -> Vec<String> {
    let mut keys: Vec<String> = vec![];
    if stream_schema_map.contains_key(&stream_name) {
        let schema = stream_schema_map.get(&stream_name).unwrap();
        let mut meta = schema.metadata().clone();
        meta.remove("created_at");

        let stream_settings = meta.get("settings");

        if let Some(value) = stream_settings {
            let settings: Value = crate::common::json::from_slice(value.as_bytes()).unwrap();
            let part_keys = settings.get("partition_keys");

            if let Some(value) = part_keys {
                let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
                v.sort_by(|a, b| a.0.cmp(b.0));
                for (_, value) in v {
                    keys.push(value.as_str().unwrap().to_string());
                }
            }
        }
    }
    keys
}
