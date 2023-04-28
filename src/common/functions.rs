pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let mut fn_list = Vec::new();
    for transform in crate::infra::config::QUERY_FUNCTIONS.iter() {
        let key = transform.key();
        let org_key = &format!("{}/", org_id);
        if key.contains(org_key) {
            if let Some(v) = key.strip_prefix(org_key).to_owned() {
                fn_list.push(v.to_string())
            }
        }
    }
    fn_list
}

#[cfg(feature = "zo_functions")]
pub fn init_vrl_runtime() -> vrl::Runtime {
    vrl::Runtime::new(vrl::state::RuntimeState::default())
}
