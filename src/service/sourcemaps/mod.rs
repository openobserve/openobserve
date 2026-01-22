use std::io::Read;

use anyhow::Context;
use hashbrown::{HashMap, HashSet};
use infra::{
    storage,
    table::source_maps::{FileType, SourceMap},
};

use super::db::sourcemaps;

const UNKNOWN_STR: &str = "<unknown>";

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

        // TODO : add a restriction on size?
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
            is_local: true,
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
) -> Result<Option<String>, anyhow::Error> {
    let service = &f.service;
    let env = &f.env;
    let version = &f.version;

    let id =
        sourcemaps::get_sourcemap_file(&f.org_id, minified_file, service, env, version).await?;
    Ok(id)
}

async fn resolve_stack(parsed: ParsedLine, f: &Filter) -> Result<String, anyhow::Error> {
    // sourcemaps crate use 0 based indexes for line and col, but stacktrace
    // has 1 based index, so we sub saturating-ly to adjust for that
    let smap_line = parsed.line.saturating_sub(1);
    let smap_col = parsed.col.saturating_sub(1);

    let Some(smap_file_name) = get_sourcemap_file_info(&parsed.file, f).await? else {
        return Err(anyhow::anyhow!(
            "sourcemap file not found for minified file {} in org_id {}",
            parsed.file,
            f.org_id
        ));
    };

    let path = get_file_path(&f.org_id, &smap_file_name);

    let get_res = storage::get("", &path).await?;
    let bytes = get_res.bytes().await?;
    let reader = sourcemap::SourceMap::from_slice(&bytes)?;

    let Some(tok) = reader.lookup_token(smap_line, smap_col) else {
        return Err(anyhow::anyhow!(
            "token at {}:{} not found in sourcemap",
            parsed.line,
            parsed.col
        ));
    };

    let (src_line, src_col) = tok.get_src();

    let sline: String;
    let scol: String;

    // sourcemap crate uses u32::MAX as an indicator value to say that
    // token was invalid or the location in the original source was not found
    // so we account for that, and set it to unknown here
    // not the best way to do, as typos can switch one to other,
    // but should be ok.
    // also sat-add 1 to re-adjust 1 based index of source files
    if src_line == u32::MAX {
        sline = UNKNOWN_STR.to_string();
    } else {
        sline = src_line.saturating_add(1).to_string();
    }

    if src_col == u32::MAX {
        scol = UNKNOWN_STR.to_string();
    } else {
        scol = src_col.saturating_add(1).to_string();
    }

    let translated = format!(
        "\tat {} @ {}:{}:{}\n",
        tok.get_name().unwrap_or(UNKNOWN_STR),
        tok.get_source().unwrap_or(UNKNOWN_STR),
        sline,
        scol
    );
    Ok(translated)
}

pub async fn translate_stacktrace(
    org_id: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    stacktrace: String,
) -> Result<String, anyhow::Error> {
    if stacktrace.is_empty() {
        return Ok(stacktrace);
    }

    let f = Filter {
        org_id: org_id.to_string(),
        service,
        env,
        version,
    };

    let mut converted_stacks = Vec::new();

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
        return Ok(stacktrace);
    };

    //  now for the reset of the lines, process them one by one
    for line in lines {
        match parse_line(line) {
            Ok(v) => {
                let t = match resolve_stack(v, &f).await {
                    Ok(v) => v,
                    Err(e) => {
                        // if there is any error, we use the original line
                        log::info!("error in translating stack for {org_id} : {e}");
                        line.to_string()
                    }
                };
                converted_stacks.push(t);
            }
            Err(_) => {
                converted_stacks.push(line.to_string());
            }
        }
    }
    let converted: String = converted_stacks.into_iter().collect();
    Ok(format!("{message}\n{converted}"))
}
