use std::io::Read;

use anyhow::Context;
use config::SOURCEMAP_FILE_MAX_SIZE;
use hashbrown::{HashMap, HashSet};
use infra::{
    storage,
    table::source_maps::{FileType, SourceMap},
};
use serde::Serialize;
#[cfg(feature = "enterprise")]
use {
    infra::client::grpc::make_grpc_search_client,
    infra::errors::ErrorCodes,
    o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config,
        super_cluster::search::get_cluster_node_by_name,
    },
};

use super::db::sourcemaps;

const UNKNOWN_STR: &str = "<unknown>";
// half-window size for returning source. Basically for trace at line l, it will return l-this -> l+
// this so total of this*2 +1 lines.
const SOURCE_CONTEXT_SIZE_HALF: u32 = 5;

// only for internal user as of now.
struct Filter {
    org_id: String,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
}

struct ParsedLine {
    file: String,
    line: u32,
    col: u32,
}

#[derive(Serialize)]
pub struct SourceData {
    pub source: String,
    pub source_line_start: u32,
    pub source_line_end: u32,
    pub stack_line: u32,
    pub stack_col: u32,
}

#[derive(Serialize)]
pub struct TranslatedStackLine {
    pub line: String,
    pub source_info: Option<SourceData>,
}

#[derive(Serialize)]
pub struct TranslatedStack {
    error: String,
    stack: Vec<TranslatedStackLine>,
}

impl TranslatedStack {
    pub fn empty() -> Self {
        Self {
            error: String::new(),
            stack: Vec::new(),
        }
    }
    pub fn empty_with_message(msg: String) -> Self {
        Self {
            error: msg,
            stack: Vec::new(),
        }
    }
    pub fn add_line(&mut self, line: TranslatedStackLine) {
        self.stack.push(line);
    }
}

fn get_file_path(org_id: &str, name: &str) -> String {
    format!("files/{org_id}/sourcemaps/{name}")
}

pub async fn process_zip(
    org_id: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    file_data: Vec<u8>,
) -> Result<(), anyhow::Error> {
    // Attempt to read the uploaded data as a ZIP file
    let mut archive = match zip::read::ZipArchive::new(std::io::Cursor::new(file_data)) {
        Ok(archive) => archive,
        Err(e) => {
            log::error!("Error reading sourcemap ZIP file for org {org_id} : {e}");
            return Err(anyhow::anyhow!("error in reading zip file : {e}"));
        }
    };
    let mut minified = HashSet::new();
    let mut map_files = HashMap::new();

    // first filter out the js and .map files from teh archive
    for name in archive.file_names() {
        if name.ends_with(".js") {
            let (_, file_name) = name.rsplit_once("/").unwrap_or(("", name));
            minified.insert(file_name.to_string());
        } else if name.ends_with(".js.map") {
            let (_, file_name) = name.rsplit_once("/").unwrap_or(("", name));
            map_files.insert(file_name.to_string(), name.to_string());
        }
    }

    let mut map_pairs = Vec::with_capacity(minified.len());

    // check that for all js files, we have a corresponding .map
    // file present. If not, currently we do not support that.
    for mfile in minified {
        let expected_mapfile = format!("{mfile}.map");

        // we expect that all minified files have corresponding maps
        // if any of them is not present, we need to error out.
        if let Some(path) = map_files.remove(&expected_mapfile) {
            map_pairs.push((mfile, (expected_mapfile, path)));
        } else {
            return Err(anyhow::anyhow!(
                "no mapfile corresponding to source {mfile} found"
            ));
        }
    }

    // for remaining map files, assume the minified files are with
    // suffix .map stripped
    for (mapfile, path) in map_files {
        log::warn!(
            "no source file found corresponding to sourcemap {mapfile} for org_id {org_id}, creating default entry."
        );
        let expected_minified = mapfile.strip_suffix(".map").unwrap();
        map_pairs.push((expected_minified.to_string(), (mapfile, path)));
    }

    let mut source_maps = Vec::with_capacity(map_pairs.len());
    let mut source_map_paths = Vec::with_capacity(map_pairs.len());

    let now = chrono::Utc::now().timestamp_micros();

    // finally, for each minified-sourcemap pair -
    // first store the sourcemap file with a uuid in storage
    // then bulk insert all file entries in the db
    // finally if db entry fails, attempt to delete from storage
    for (minified, (smap, path)) in map_pairs {
        let mut file = archive
            .by_path(&path)
            .context(format!("path {path} missing unexpectedly in archive"))?;

        if file.size() > SOURCEMAP_FILE_MAX_SIZE {
            return Err(anyhow::anyhow!(
                "file {} in zip exceeds maximum allowed file size.",
                path
            ));
        }
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buf)?;

        let id = config::ider::uuid();
        let storage_name = format!("{id}.js.map");
        let path = get_file_path(org_id, &storage_name);
        source_map_paths.push(path.clone());

        storage::put("", &path, buf.into()).await?;

        let sourcemap = SourceMap {
            id: 0,
            org: org_id.to_string(),
            service: service.clone(),
            env: env.clone(),
            version: version.clone(),
            source_file_name: minified,
            source_map_file_name: smap,
            file_store_id: storage_name,
            file_type: FileType::SourceMap,
            cluster: config::get_cluster_name(),
            created_at: now,
        };
        source_maps.push(sourcemap);
    }

    if let Err(e) = sourcemaps::add_many(source_maps).await {
        log::error!("error saving sourcemaps in db for org_id {org_id} : {e}");
        let temp = source_map_paths.iter().map(|p| ("", p.as_str())).collect();
        if let Err(e) = storage::del(temp).await {
            log::warn!(
                "error deleting files from storage after sourcemap saving error for org_id {org_id} {e} "
            );
        }
        return Err(e);
    }

    Ok(())
}

fn parse_line(line: &str) -> Result<ParsedLine, ()> {
    // here the line will be of form
    // at i @ http://localhost:4173/assets/AboutView-CfTko3_E.js:1:301
    // with possible space at start and end.

    // start with trimming it on both sides
    let trimmed = line.trim();

    // at any point, if the processing fails, we will return the original line

    // first split at @ to get the path which includes file name and position
    let Some((_, origin_path)) = trimmed.split_once("@") else {
        return Err(());
    };
    // now it will be something like http://localhost:4173/assets/AboutView-CfTko3_E.js:1:301

    // it might not be a url, which means it might not have / in it
    // so we fallback to original string, if the rsplit fails
    let file_pos = match origin_path.rsplit_once("/") {
        Some((_, v)) => v,
        None => origin_path,
    };
    // ideally here it will be something like AboutView-CfTko3_E.js:1:301

    let Some((file, pos_str)) = file_pos.split_once(":") else {
        return Err(());
    };

    let Some((line_str, col_str)) = pos_str.split_once(":") else {
        return Err(());
    };

    match (line_str.parse::<u32>(), col_str.parse::<u32>()) {
        (Ok(l), Ok(c)) => Ok(ParsedLine {
            file: file.to_string(),
            line: l,
            col: c,
        }),
        _ => Err(()),
    }
}

async fn get_sourcemap_file_info(
    minified_file: &str,
    f: &Filter,
) -> Result<Option<SourceMap>, anyhow::Error> {
    let service = &f.service;
    let env = &f.env;
    let version = &f.version;

    let info =
        sourcemaps::get_sourcemap_file(&f.org_id, minified_file, service, env, version).await?;
    Ok(info)
}

// this function does not return error, as we do not have retry.
// if something fails in this attempt which is a temporary failure
// when that sourcemap is fetched again, this will be retried
#[cfg(feature = "enterprise")]
async fn store_file_locally(mut smap_info: SourceMap, file_data: bytes::Bytes) {
    let path = get_file_path(&smap_info.org, &smap_info.file_store_id);
    log::info!(
        "storing sourcemap file for org_id {} path {path} in local cluster",
        smap_info.org,
    );
    if let Err(e) = storage::put("", &path, file_data).await {
        log::error!(
            "error storing sourcemap file {}/{} at path {path} in local cluster : {e}",
            smap_info.org,
            smap_info.source_map_file_name,
        );
        return;
    }
    let org = smap_info.org.clone();
    let fname = smap_info.source_map_file_name.clone();
    smap_info.cluster = config::get_cluster_name();
    if let Err(e) = sourcemaps::update_file_cluster(smap_info).await {
        log::error!(
            "error updating db to set local cluster in sourcemap for file {org}/{fname} : {e}"
        );
    }
    log::info!("stored sourcemap file for org_id {org} path {path} in local cluster successfully");
}

async fn get_sourcemap_file_data(
    org_id: &str,
    smap_file: &SourceMap,
) -> Result<bytes::Bytes, anyhow::Error> {
    let path = get_file_path(org_id, &smap_file.file_store_id);
    if smap_file.cluster == config::get_cluster_name() {
        let get_res = storage::get("", &path).await?;
        let bytes = get_res.bytes().await?;
        return Ok(bytes);
    }

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let trace_id = config::ider::generate_trace_id();
        let node = get_cluster_node_by_name(&smap_file.cluster).await?;
        let file_path = path.clone();
        let org = org_id.to_string();
        let original_name = smap_file.source_map_file_name.clone();
        let cluster = smap_file.cluster.to_string();

        log::info!("getting sourcemap file for org_id {org} path {path} from cluster {cluster}");

        let task = tokio::task::spawn(async move {
            let mut request = tonic::Request::new(proto::cluster_rpc::GetSourcemapFileRequest {
                org_id: org.clone(),
                path: file_path.clone(),
                original_name,
            });
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
            match client.get_sourcemap_file(request).await {
                Ok(res) => {
                    let response = res.into_inner();
                    Ok(response.file_data)
                }
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] error getting sourcemap file from cluster {cluster} node {} for org_id {org} path {file_path} : {err:?}",
                        &node.get_grpc_addr(),
                    );
                    let err = ErrorCodes::from_json(err.message())?;
                    Err(anyhow::anyhow!(
                        "error getting file from other cluster : {err}",
                    ))
                }
            }
        });
        let response = task
            .await
            .map_err(|e| anyhow::anyhow!("internal error : {e}"))?;
        match response {
            Ok(v) => {
                log::info!(
                    "successfully received sorucemap file org_id {org_id} path {path} from cluster {}",
                    smap_file.cluster
                );
                let bytes = bytes::Bytes::from(v);
                let smap_copy = smap_file.clone();
                let bytes_copy = bytes.clone();
                tokio::spawn(async { store_file_locally(smap_copy, bytes_copy).await });
                return Ok(bytes);
            }
            Err(e) => return Err(e),
        }
    }

    // if super cluster is not enabled AND cluster name is not same
    // then we cannot do anything, so this is the default fallback to error
    Err(anyhow::anyhow!(
        "unexpected cluster name {} and super cluster not enabled",
        smap_file.cluster
    ))
}

async fn resolve_stack(
    parsed: ParsedLine,
    f: &Filter,
    cache: &mut HashMap<String, sourcemap::SourceMap>,
) -> Result<TranslatedStackLine, anyhow::Error> {
    // sourcemaps crate use 0 based indexes for line and col, but stacktrace
    // has 1 based index, so we sub saturating-ly to adjust for that
    let smap_line = parsed.line.saturating_sub(1);
    let smap_col = parsed.col.saturating_sub(1);

    // this cache is "local" to a particular resolve call, so we don't
    // need to add org id  or service etc, as wel know all files resolved
    // would be in the same context. The cache helps us
    // when same files appears multiple times in trace, we don't have
    // to re-fetch and re-parse the sourcemap every time at the cost of memory
    let reader = match cache.get(&parsed.file) {
        Some(v) => v,
        None => {
            let Some(smap_file_info) = get_sourcemap_file_info(&parsed.file, f).await? else {
                return Err(anyhow::anyhow!(
                    "sourcemap file not found for minified file {} in org_id {}",
                    parsed.file,
                    f.org_id
                ));
            };

            let bytes = get_sourcemap_file_data(&f.org_id, &smap_file_info).await?;
            let reader = sourcemap::SourceMap::from_slice(&bytes)?;

            cache.insert(parsed.file.clone(), reader);
            cache.get(&parsed.file).unwrap()
        }
    };

    let Some(tok) = reader.lookup_token(smap_line, smap_col) else {
        return Err(anyhow::anyhow!(
            "token at {}:{} not found in sourcemap",
            parsed.line,
            parsed.col
        ));
    };

    let (src_line, src_col) = tok.get_src();

    // sourcemap crate uses u32::MAX as an indicator value to say that
    // token was invalid or the location in the original source was not found
    // so we account for that, and set it to unknown here
    // not the best way to do, as typos can switch one to other,
    // but should be ok.
    // also sat-add 1 to re-adjust 1 based index of source files
    let sline = if src_line == u32::MAX {
        UNKNOWN_STR.to_string()
    } else {
        src_line.saturating_add(1).to_string()
    };

    let scol = if src_col == u32::MAX {
        UNKNOWN_STR.to_string()
    } else {
        src_col.saturating_add(1).to_string()
    };

    let translated = format!(
        "at {} @ {}:{}:{}",
        tok.get_name().unwrap_or(UNKNOWN_STR),
        tok.get_source().unwrap_or(UNKNOWN_STR),
        sline,
        scol
    );
    let mut sdata = None;
    if src_line != u32::MAX
        && let Some(s) = tok.get_source_view()
    {
        let src_adj = src_line.saturating_add(1);
        let src_ctx_start = src_adj.saturating_sub(SOURCE_CONTEXT_SIZE_HALF);
        let mut src_ctx_end = src_adj.saturating_add(SOURCE_CONTEXT_SIZE_HALF);

        let mut src_lines = Vec::new();

        for i in src_ctx_start..=src_ctx_end {
            if let Some(line) = s.get_line(i) {
                src_lines.push(line.to_string());
            } else {
                src_ctx_end = i;
                break;
            }
        }
        sdata = Some(SourceData {
            source: src_lines.join("\n"),
            source_line_start: src_ctx_start,
            source_line_end: src_ctx_end,
            stack_line: src_adj,
            stack_col: src_col.saturating_add(1),
        });
    }
    Ok(TranslatedStackLine {
        line: translated,
        source_info: sdata,
    })
}

pub async fn translate_stacktrace(
    org_id: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    stacktrace: String,
) -> Result<TranslatedStack, anyhow::Error> {
    if stacktrace.is_empty() {
        return Ok(TranslatedStack::empty());
    }

    let mut sourcemap_cache = HashMap::new();

    let f = Filter {
        org_id: org_id.to_string(),
        service,
        env,
        version,
    };

    // here, the stack trace will be something like
    // TypeError: can't access property "toUpperCase" of null
    //     at i @ http://localhost:4173/assets/AboutView-CfTko3_E.js:1:301
    //     at Oe @ http://localhost:4173/assets/index-oRhIbTrc.js:2:18838
    //     at Ie @ http://localhost:4173/assets/index-oRhIbTrc.js:2:18910
    //     at n @ http://localhost:4173/assets/index-oRhIbTrc.js:2:56810

    // so first, split it into lines
    let mut lines = stacktrace.split("\n");
    // first line is message, so extract is separately.
    let Some(message) = lines.next() else {
        return Ok(TranslatedStack::empty_with_message(stacktrace));
    };

    let mut translated_stack = TranslatedStack::empty_with_message(message.to_string());

    //  now for the reset of the lines, process them one by one
    for line in lines {
        match parse_line(line) {
            Ok(v) => {
                let t = match resolve_stack(v, &f, &mut sourcemap_cache).await {
                    Ok(v) => v,
                    Err(e) => {
                        // if there is any error, we use the original line
                        log::info!("error in translating stack for {org_id} : {e}");
                        TranslatedStackLine {
                            line: line.to_string(),
                            source_info: None,
                        }
                    }
                };
                translated_stack.add_line(t);
            }
            Err(_) => {
                let fallback_line = TranslatedStackLine {
                    line: line.to_string(),
                    source_info: None,
                };
                translated_stack.add_line(fallback_line);
            }
        }
    }
    Ok(translated_stack)
}

#[cfg(test)]
mod tests {

    use std::collections::HashSet;

    use super::{super::db::sourcemaps::*, *};

    async fn upload_zip(svc: &str, env: &str, version: &str) {
        delete_group(
            "default",
            Some(svc.into()),
            Some(env.into()),
            Some(version.into()),
        )
        .await
        .unwrap();
        let f = std::fs::read("tests/sourcemaps.zip").unwrap();
        process_zip(
            "default",
            Some(svc.into()),
            Some(env.into()),
            Some(version.into()),
            f,
        )
        .await
        .unwrap();
    }

    // tests extraction and processing of zip works fine
    #[tokio::test]
    async fn test_zip_processing() {
        upload_zip("svc1", "env1", "v1").await;
    }

    #[tokio::test]
    async fn test_list_files() {
        let expected = HashSet::from_iter([
            "AboutView-RC3okFHd.js.map".to_string(),
            "index-BO6PqLMi.js.map".to_string(),
            "profiler-Dq395iFC.js.map".to_string(),
            "startRecording-DDLxttnr.js.map".to_string(),
        ]);

        upload_zip("svc1", "env1", "v1").await;
        let res = list_files(
            "default",
            Some("svc1".into()),
            Some("env1".into()),
            Some("v1".into()),
        )
        .await
        .unwrap();
        assert_eq!(res.len(), 4);
        let t: HashSet<_> = res
            .iter()
            .map(|v| v.source_map_file_name.to_string())
            .collect();
        assert_eq!(t, expected);

        let res = list_files(
            "org2",
            Some("svc1".into()),
            Some("env1".into()),
            Some("v1".into()),
        )
        .await
        .unwrap();
        assert!(res.is_empty());

        let res = list_files("default", Some("svc1".into()), None, Some("v1".into()))
            .await
            .unwrap();
        assert_eq!(res.len(), 4);

        let t: HashSet<_> = res
            .iter()
            .map(|v| v.source_map_file_name.to_string())
            .collect();
        assert_eq!(t, expected);

        let res = list_files("default", None, Some("env1".into()), Some("v1".into()))
            .await
            .unwrap();
        assert_eq!(res.len(), 4);
        let t: HashSet<_> = res
            .iter()
            .map(|v| v.source_map_file_name.to_string())
            .collect();
        assert_eq!(t, expected);

        let res = list_files("default", Some("svc1".into()), Some("env1".into()), None)
            .await
            .unwrap();
        assert_eq!(res.len(), 4);
        let t: HashSet<_> = res
            .iter()
            .map(|v| v.source_map_file_name.to_string())
            .collect();
        assert_eq!(t, expected);
    }

    #[tokio::test]
    async fn test_delete_files() {
        let expected = HashSet::from_iter([
            "AboutView-RC3okFHd.js.map".to_string(),
            "index-BO6PqLMi.js.map".to_string(),
            "profiler-Dq395iFC.js.map".to_string(),
            "startRecording-DDLxttnr.js.map".to_string(),
        ]);
        upload_zip("svc1", "env1", "v1").await;
        // for deletion the filters much match exactly, so nothing should be deleted here
        delete_group("default", None, Some("env1".into()), Some("v1".into()))
            .await
            .unwrap();

        // list matches filter approximately, so we should still get list here
        let res = list_files("default", None, Some("env1".into()), Some("v1".into()))
            .await
            .unwrap();
        assert_eq!(res.len(), 4);
        let t: HashSet<_> = res
            .iter()
            .map(|v| v.source_map_file_name.to_string())
            .collect();
        assert_eq!(t, expected);

        delete_group(
            "default",
            Some("svc1".into()),
            Some("env1".into()),
            Some("v1".into()),
        )
        .await
        .unwrap();
        let res = list_files("default", None, Some("env1".into()), Some("v1".into()))
            .await
            .unwrap();
        assert!(res.is_empty());
    }

    #[tokio::test]
    async fn test_translate() {
        let stack1 = "TypeError: can't access property \"nonExistent\", e is undefined\n  at setup/b/< @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:338\n  at setup/b/< @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:538\n  at b @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:542\n  at i @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:210\n  at Oe @ http://localhost:4173/assets/index-BO6PqLMi.js:2:18838\n  at Ie @ http://localhost:4173/assets/index-BO6PqLMi.js:2:18910\n  at n @ http://localhost:4173/assets/index-BO6PqLMi.js:2:56810";

        upload_zip("svc1", "env1", "v1").await;

        // valid stack and smap
        let res = translate_stacktrace(
            "default",
            Some("svc1".into()),
            Some("env1".into()),
            Some("v1".into()),
            stack1.into(),
        )
        .await
        .unwrap();

        assert_eq!(
            res.error,
            "TypeError: can't access property \"nonExistent\", e is undefined"
        );
        assert_eq!(res.stack.len(), 7);

        assert_eq!(
            res.stack[0].line,
            "at obj @ ../../src/components/ErrorDemo.vue:56:17"
        );
        assert_eq!(
            res.stack[1].line,
            "at fn3 @ ../../src/components/ErrorDemo.vue:49:3"
        );
        assert_eq!(
            res.stack[2].line,
            "at fn2 @ ../../src/components/ErrorDemo.vue:45:3"
        );
        assert_eq!(
            res.stack[3].line,
            "at fn1 @ ../../src/components/ErrorDemo.vue:31:3"
        );
        assert_eq!(
            res.stack[4].line,
            "at fn @ ../../node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js:199:19"
        );
        assert_eq!(
            res.stack[5].line,
            "at callWithErrorHandling @ ../../node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js:206:17"
        );
        assert_eq!(
            res.stack[6].line,
            "at callWithAsyncErrorHandling @ ../../node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js:730:5"
        );

        // valid stack but no smap for given params
        let res = translate_stacktrace(
            "default",
            Some("svc2".into()),
            Some("env2".into()),
            Some("v2".into()),
            stack1.into(),
        )
        .await
        .unwrap();

        assert_eq!(
            res.error,
            "TypeError: can't access property \"nonExistent\", e is undefined"
        );
        assert_eq!(res.stack.len(), 7);

        assert_eq!(
            res.stack[0].line,
            "  at setup/b/< @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:338"
        );
        assert!(res.stack[0].source_info.is_none());
        assert_eq!(
            res.stack[1].line,
            "  at setup/b/< @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:538"
        );
        assert!(res.stack[1].source_info.is_none());
        assert_eq!(
            res.stack[2].line,
            "  at b @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:542"
        );
        assert!(res.stack[2].source_info.is_none());

        let stack2 = "TypeError: can't access property \"nonExistent\", e is undefined\n  at setup/n/< @ http://localhost:4173/assets/AboutView-RC3okFH.js:1558:838878\n  at setup/b/< @ http://localhost:4173/assets/AboutView-RCokFHd.js:1:538\n  at b @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:542\n  at i @ http://localhost:4173/assets/AboutView-RC3okFHd.js:1:210\n  at Oe @ http://localhost:4173/assets/index-BO6PqLMi.js:2:18838\n  at Ie @ http://localhost:4173/assets/index-BO6PqLMi.js:2:18910\n  at n @ http://localhost:4173/assets/index-BO6PqLMi.js:2:56810";

        // stack is incorrect
        let res = translate_stacktrace(
            "default",
            Some("svc1".into()),
            Some("env1".into()),
            Some("v1".into()),
            stack2.into(),
        )
        .await
        .unwrap();

        assert_eq!(
            res.error,
            "TypeError: can't access property \"nonExistent\", e is undefined"
        );
        assert_eq!(res.stack.len(), 7);

        assert_eq!(
            res.stack[0].line,
            "  at setup/n/< @ http://localhost:4173/assets/AboutView-RC3okFH.js:1558:838878"
        );
        assert!(res.stack[0].source_info.is_none());
        assert_eq!(
            res.stack[1].line,
            "  at setup/b/< @ http://localhost:4173/assets/AboutView-RCokFHd.js:1:538"
        );
        assert!(res.stack[1].source_info.is_none());
        assert_eq!(
            res.stack[2].line,
            "at fn2 @ ../../src/components/ErrorDemo.vue:45:3"
        );
        assert!(res.stack[2].source_info.is_some());
    }

    #[test]
    fn test_parse_line_valid() {
        let line = "at myFn @ http://localhost:4173/assets/App-Dfx1Q7gE.js:1:42";
        let result = parse_line(line);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.file, "App-Dfx1Q7gE.js");
        assert_eq!(parsed.line, 1);
        assert_eq!(parsed.col, 42);
    }

    #[test]
    fn test_parse_line_no_at_symbol_returns_err() {
        let line = "http://localhost:4173/assets/App.js:1:42";
        assert!(parse_line(line).is_err());
    }

    #[test]
    fn test_parse_line_no_colon_after_filename_returns_err() {
        let line = "at fn @ http://localhost:4173/assets/App.js";
        assert!(parse_line(line).is_err());
    }

    #[test]
    fn test_parse_line_non_numeric_position_returns_err() {
        let line = "at fn @ http://localhost:4173/assets/App.js:x:y";
        assert!(parse_line(line).is_err());
    }

    #[test]
    fn test_get_file_path() {
        let path = get_file_path("myorg", "mysourcemap.js.map");
        assert_eq!(path, "files/myorg/sourcemaps/mysourcemap.js.map");
    }

    #[test]
    fn test_translated_stack_empty() {
        let s = TranslatedStack::empty();
        assert!(s.error.is_empty());
        assert!(s.stack.is_empty());
    }

    #[test]
    fn test_translated_stack_empty_with_message() {
        let s = TranslatedStack::empty_with_message("something went wrong".to_string());
        assert_eq!(s.error, "something went wrong");
        assert!(s.stack.is_empty());
    }

    #[test]
    fn test_translated_stack_add_line() {
        let mut s = TranslatedStack::empty();
        s.add_line(TranslatedStackLine {
            line: "at fn @ file.js:1:2".to_string(),
            source_info: None,
        });
        assert_eq!(s.stack.len(), 1);
        assert_eq!(s.stack[0].line, "at fn @ file.js:1:2");
    }

    #[test]
    fn test_parse_line_no_slash_in_path_uses_full_segment() {
        // When no slash, origin_path (including leading space) is used as file_pos.
        // The file field will retain any leading whitespace from the split.
        let line = "at fn @ App.js:1:5";
        let result = parse_line(line);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        // origin_path is " App.js:1:5" (leading space), so file is " App.js"
        assert!(parsed.file.contains("App.js"));
        assert_eq!(parsed.line, 1);
        assert_eq!(parsed.col, 5);
    }
}
