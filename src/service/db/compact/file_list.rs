// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub async fn get_offset() -> Result<i64, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/file_list/offset";
    let value = match db.get(key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    let offset: i64 = value.parse().unwrap();
    Ok(offset)
}

pub async fn set_offset(offset: i64) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/file_list/offset";
    db.put(key, offset.to_string().into()).await?;
    Ok(())
}

pub async fn set_delete(key: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/file_list/delete/{key}");
    db.put(&key, "OK".into()).await?;
    Ok(())
}

pub async fn del_delete(key: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/file_list/delete/{key}");
    db.delete_if_exists(&key, false).await.map_err(Into::into)
}

pub async fn list_delete() -> Result<Vec<String>, anyhow::Error> {
    let mut items = Vec::new();
    let db = &crate::infra::db::DEFAULT;
    let key = "/compact/file_list/delete/";
    for (item_key, _item_value) in db.list(key).await? {
        let item_key = item_key.strip_prefix(key).unwrap();
        items.push(item_key.to_string());
    }
    Ok(items)
}

pub async fn get_process(offset: i64) -> String {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/file_list/process/{offset}");
    match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from(""),
    }
}

pub async fn set_process(offset: i64, node: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/file_list/process/{offset}");
    db.put(&key, node.to_string().into()).await?;
    Ok(())
}

pub async fn del_process(offset: i64) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/compact/file_list/process/{offset}");
    db.delete_if_exists(&key, false).await.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_file_list_offset() {
        const OFFSET: i64 = 100;

        set_offset(OFFSET).await.unwrap();
        assert_eq!(get_offset().await.unwrap(), OFFSET);

        let delete_day = "2023-03-03";
        set_delete(delete_day).await.unwrap();
        assert_eq!(list_delete().await.unwrap(), vec![delete_day.to_string()]);
    }

    #[tokio::test]
    async fn test_file_list_process_offset() {
        const OFFSET: i64 = 100;
        const NODE: &str = "node1";

        set_process(OFFSET, NODE).await.unwrap();
        assert_eq!(get_process(OFFSET).await, NODE);
    }
}
