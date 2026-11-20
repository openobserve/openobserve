// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { CancelledError } from "@tanstack/vue-query";
import { effectScope, getCurrentScope, nextTick, onScopeDispose, ref, type EffectScope } from "vue";
import { byString } from "@/utils/json";
import { useI18nTyped, raw } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";

import { searchState } from "@/composables/useLogs/searchState";
import { columnsFromUrl } from "@/composables/useLogs/useLogPermalink";
import useStreams from "@/composables/useStreams";
import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import useSqlSuggestions from "@/composables/useSuggestions";
import { captureFromSearchHits } from "@/composables/fieldValueStore";

import {
  useLocalLogFilterField,
  timestampToTimezoneDate,
  useLocalInterestingFields,
} from "@/utils/zincutils";
import { useCorrelationFilters } from "@/composables/useCorrelationDefaultSlug";

import { logsUtils } from "@/composables/useLogs/logsUtils";
import { bumpSeveritySchemaGeneration } from "@/utils/logs/statusParser";
import {
  buildSemanticIndex,
  applyFieldGrouping,
  applyStreamGrouping,
  type FieldObj,
} from "@/utils/fieldCategories";
import { streamGroupLabels } from "@/composables/useFieldGrouping";
import { interestingRowsOf } from "@/utils/logs/interestingFields";
import { buildStreamNameColumn, shouldShowStreamNameColumn } from "@/utils/logs/streamNameColumn";
import type { KeyFieldsConfig, FieldGroupingConfig } from "@/composables/useServiceCorrelation";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { getCachedSemanticGroups } from "@/utils/semanticGroupsCache";
import type { FieldAlias } from "@/services/service_streams";
import { isGuardActive } from "@/composables/useLogs/useAutoRun";
import { pickLatestStream, type StreamStatsEntry } from "@/utils/logs/estimateScanMb";
import { restoreLogsSelectedStreams } from "@/utils/streamPersist";
import { sqlSources } from "@/utils/logs/sqlSources";

/** How long a cold load keeps the field list loading for the semantic groups before showing it ungrouped. */
export const FIELD_GROUPS_WAIT_MS = 1000;

let correlationWatcherUsers = 0;
let correlationWatcherScope: EffectScope | null = null;
let fieldGroupsHoldId = 0;
// Streams a fresh list already lacked: re-asking for them on every load would only repeat the miss.
const refetchedMissing = new Set<string>();

export interface InitialStreamInput {
  list: StreamStatsEntry[];
  current: string[];
  currentFromUrl: boolean;
  persisted: string[];
  allowLatest: boolean;
}

export interface InitialStreamPick {
  selected: string[];
  missing: string[];
  source: "url" | "current" | "persisted" | "latest" | "none";
}

export interface StreamListOptions {
  fromUrl?: boolean;
  isCurrent?: () => boolean;
  /** Reads the list from the server even while the cached copy is fresh. */
  force?: boolean;
}

export interface ExtractFieldsOptions {
  reuseLoadedSchema?: boolean;
  /** Rebuilds the field list from already-loaded schemas with groups that changed after the first build; search errors and the loading flag are left alone. */
  regroupWith?: FieldAlias[];
}

export function pickInitialLogsStreams(input: InitialStreamInput): InitialStreamPick {
  const readable = new Set(input.list.map((entry) => entry.name));
  const current = input.current.filter((name) => !!name);
  if (current.length) {
    const valid = current.filter((name) => readable.has(name));
    const missing = current.filter((name) => !readable.has(name));
    if (input.currentFromUrl) {
      return missing.length
        ? { selected: [], missing, source: "url" }
        : { selected: valid, missing: [], source: "url" };
    }
    if (valid.length) return { selected: valid, missing, source: "current" };
  }
  const persisted = input.persisted.filter((name) => readable.has(name));
  if (persisted.length) return { selected: persisted, missing: [], source: "persisted" };
  const latest = input.allowLatest ? pickLatestStream(input.list) : null;
  if (latest) return { selected: [latest], missing: [], source: "latest" };
  return { selected: [], missing: [], source: "none" };
}

export const useStreamFields = () => {
  const { t } = useI18nTyped();
  const { getStreams, getStream, prefetchStreamSchema } = useStreams(t);
  const { updateFieldKeywords } = useSqlSuggestions();
  const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } = useServiceCorrelation();

  const store = useStore();
  const router = useRouter();

  let {
    searchObj,
    searchObjDebug,
    fieldValues,
    clearFieldValues,
    notificationMsg,
    streamSchemaFieldsIndexMapping,
    schemaRequestToken,
  } = searchState();

  const { fnParsedSQL, getColumnWidth } = logsUtils();

  const correlationFilters = useCorrelationFilters({
    orgId: () => store.state.selectedOrganization.identifier,
    streamType: () => searchObj.data.stream.streamType,
    streamName: () => searchObj.data.stream.selectedStream[0],
    streamSchemaFields: () => searchObj.data.stream.selectedStreamFields,
    getQuery: () => searchObj.data.query || searchObj.data.editorValue,
    setQuery: (whereClause: string) => {
      searchObj.data.query = whereClause;
      searchObj.data.editorValue = whereClause;
      searchObj.meta.sqlMode = false;
    },
    querySource: () => searchObj.data.query,
  });
  retainCorrelationQueryWatcher(correlationFilters.watchQuery);

  const updateFieldValues = () => {
    try {
      const hits = searchObj.data.queryResults.hits;

      // Background capture into IndexedDB — must run BEFORE the loop below,
      // which has an early `return` on excluded fields that would otherwise
      // prevent this from running.
      if (hits?.length > 0) {
        const schemaFields = (searchObj.data.stream.selectedStreamFields ?? []).map(
          (f: any) => f.name ?? f,
        );
        captureFromSearchHits(
          {
            org: searchObj.organizationIdentifier,
            streamType: searchObj.data.stream.streamType ?? "logs",
            streamName: searchObj.data.stream.selectedStream?.[0] ?? "",
          },
          hits,
          schemaFields,
        );
      }

      const excludedFields = [store.state.zoConfig.timestamp_column, "log", "msg"];
      // searchObj.data.queryResults.hits.forEach((item: { [x: string]: any }) => {
      for (const item of hits) {
        // Create set for each field values and add values to corresponding set
        // Object.keys(item).forEach((key) => {
        for (const key of Object.keys(item)) {
          if (excludedFields.includes(key)) {
            continue;
          }

          if (fieldValues.value === undefined) {
            fieldValues.value = {};
          }

          if (fieldValues.value[key] == undefined) {
            fieldValues.value[key] = new Set();
          }

          if (!fieldValues.value[key].has(item[key])) {
            fieldValues.value[key].add(item[key]);
          }
        }
      }
    } catch (e: any) {
      console.log("Error while updating field values", e);
    }
  };

  const extractFields = async (options: ExtractFieldsOptions = {}) => {
    schemaRequestToken.value++;
    const capturedToken = schemaRequestToken.value;
    const regroupPass = options.regroupWith !== undefined;
    const orgId = store.state.selectedOrganization.identifier;
    let lateSemanticGroups: { load: Promise<FieldAlias[]>; used: FieldAlias[] } | null = null;
    // A list still held for its groups has not been shown yet.
    const listWasEmpty =
      !searchObj.data.stream.selectedStreamFields?.length || searchObj.loadingFieldGroups;
    if (!regroupPass) searchObj.loadingStream = true;
    await nextTick();
    try {
      searchObjDebug["extractFieldsStartTime"] = performance.now();
      searchObjDebug["extractFieldsWithAPI"] = "";
      if (!regroupPass) {
        searchObj.data.errorMsg = "";
        searchObj.data.errorDetail = "";
        searchObj.data.countErrorMsg = "";
      }
      // The list is assigned once at the end: clearing it first would empty the sidebar and drop its scroll position.
      searchObj.data.stream.interestingFieldList = [];
      if (searchObj.data.streamResults.list.length > 0) {
        const timestampField = store.state.zoConfig.timestamp_column;
        const allField = store.state.zoConfig?.all_fields_name;
        let userDefineSchemaSettings: any = [];
        // True once any selected stream defines a schema; a stream picked earlier must not leak in.
        let hasDefinedSchema = false;
        // Keyed by name so a field shared by several streams is one row carrying every stream.
        const fieldMap = new Map<string, FieldObj>();
        const localInterestingFields: any = useLocalInterestingFields();
        let streamInterestingFieldsLocal: any = [];

        const streamType = searchObj.data.stream.streamType || "logs";

        const isEnterprise = config.isEnterprise === "true" || config.isCloud === "true";
        let semanticAliases: FieldAlias[] = options.regroupWith ?? [];
        if (isEnterprise && !regroupPass) {
          // The search waits on this function, so a slow groups request must not hold it; changed groups regroup when they land.
          semanticAliases = getCachedSemanticGroups(orgId) ?? [];
          lateSemanticGroups = { load: loadSemanticGroups(), used: semanticAliases };
        }
        const [keyFieldsConfig, fieldGrouping] = await Promise.all([
          loadKeyFields(),
          loadFieldGrouping(),
        ]);
        const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
          ? (fieldGrouping as FieldGroupingConfig)
          : null;
        const semanticIndex =
          semanticAliases.length > 0 ? buildSemanticIndex(semanticAliases, grouping) : null;
        const keySpec = (keyFieldsConfig as KeyFieldsConfig)[streamType] ?? {
          fields: [],
          groups: [],
        };
        const keyFieldSet = new Set(keySpec.fields.map((f) => f.toLowerCase()));
        const keyGroupSet = new Set(keySpec.groups.map((g) => g.toLowerCase()));

        searchObj.data.datetime.queryRangeRestrictionMsg = "";
        searchObj.data.datetime.queryRangeRestrictionInHour = -1;

        for (const stream of searchObj.data.streamResults.list) {
          if (!searchObj.data.stream.selectedStream.includes(stream.name)) continue;

          const streamData =
            options.reuseLoadedSchema && Array.isArray(stream.schema)
              ? {
                  schema: stream.schema,
                  settings: stream.settings,
                  removedSchemaFields: stream.removedSchemaFields,
                }
              : await loadStreamFields(stream.name);
          if (capturedToken !== schemaRequestToken.value) return;
          if (streamData.schema === undefined) {
            searchObj.loadingStream = false;
            searchObj.data.errorMsg = t("search.noFieldFound");
            throw new Error(searchObj.data.errorMsg);
          }

          stream.settings = { ...streamData.settings };
          stream.schema = [...streamData.schema];
          stream.removedSchemaFields = [...(streamData.removedSchemaFields ?? [])];

          userDefineSchemaSettings = stream.settings?.defined_schema_fields?.slice() || [];

          if (
            (stream.settings.max_query_range > 0 || store.state.zoConfig.max_query_range > 0) &&
            (searchObj.data.datetime.queryRangeRestrictionInHour >
              stream.settings.max_query_range ||
              stream.settings.max_query_range === 0 ||
              searchObj.data.datetime.queryRangeRestrictionInHour === -1) &&
            searchObj.data.datetime.queryRangeRestrictionInHour !== 0
          ) {
            // The stream's own limit wins over the config default.
            searchObj.data.datetime.queryRangeRestrictionInHour =
              stream.settings.max_query_range > 0
                ? stream.settings.max_query_range
                : store.state.zoConfig.max_query_range;

            searchObj.data.datetime.queryRangeRestrictionMsg = t(
              "search.queryRangeRestrictionMsg",
              {
                // `{range}` lands inside a translated sentence, so its unit is translated through its own plural key.
                range: t("search.queryRangeHours", {
                  count: searchObj.data.datetime.queryRangeRestrictionInHour,
                }),
              },
            );
          }

          let environmentInterestingFields = new Set();
          if (
            Object.prototype.hasOwnProperty.call(store.state.zoConfig, "default_quick_mode_fields")
          ) {
            environmentInterestingFields = new Set(
              store.state?.zoConfig?.default_quick_mode_fields,
            );
          }

          if (
            Object.prototype.hasOwnProperty.call(stream.settings, "defined_schema_fields") &&
            userDefineSchemaSettings.length > 0
          ) {
            hasDefinedSchema = true;
            if (Object.prototype.hasOwnProperty.call(store.state.zoConfig, "timestamp_column")) {
              userDefineSchemaSettings.push(store.state.zoConfig?.timestamp_column);
            }

            if (Object.prototype.hasOwnProperty.call(store.state.zoConfig, "all_fields_name")) {
              userDefineSchemaSettings.push(store.state.zoConfig?.all_fields_name);
            }
          }

          // The timestamp is interesting by default, so a stored entry for it is dropped.
          if (hasInterestingFieldsInLocal(stream.name)) {
            const hasTimestampField = localInterestingFields.value[
              searchObj.organizationIdentifier + "_" + stream.name
            ].some((field: string) => field === store.state.zoConfig?.timestamp_column);

            if (hasTimestampField) {
              localInterestingFields.value[searchObj.organizationIdentifier + "_" + stream.name] =
                localInterestingFields.value[
                  searchObj.organizationIdentifier + "_" + stream.name
                ].filter((field: string) => field !== store.state.zoConfig?.timestamp_column);
            }

            useLocalInterestingFields(localInterestingFields.value);
          }

          const deselectedFields =
            localInterestingFields.value?.[
              "deselect" + "_" + searchObj.organizationIdentifier + "_" + stream.name
            ];

          // A deselect entry only matters while its field is still a default.
          if (deselectedFields && deselectedFields.length > 0) {
            localInterestingFields.value[
              "deselect" + "_" + searchObj.organizationIdentifier + "_" + stream.name
            ] = (deselectedFields as string[]).filter((field) =>
              environmentInterestingFields.has(field),
            );
          }

          const filteredDeselectedFields = new Set(
            localInterestingFields.value?.[
              "deselect" + "_" + searchObj.organizationIdentifier + "_" + stream.name
            ] || [],
          );

          const filteredEnvironmentInterestingFields = Array.from(
            environmentInterestingFields,
          ).filter((field) => !filteredDeselectedFields.has(field));

          streamInterestingFieldsLocal = hasInterestingFieldsInLocal(stream.name)
            ? [
                ...(localInterestingFields.value?.[
                  searchObj.organizationIdentifier + "_" + stream.name
                ] ?? []),
                ...filteredEnvironmentInterestingFields,
              ]
            : [...filteredEnvironmentInterestingFields];

          const intField = new Set([
            ...searchObj.data.stream.interestingFieldList,
            ...streamInterestingFieldsLocal,
            store.state.zoConfig?.timestamp_column,
          ]);

          searchObj.data.stream.interestingFieldList = Array.from(intField);

          const schemaTypeMap: Record<string, string> = {};
          const definedFields = stream.settings?.defined_schema_fields || [];
          const tsCol = store.state.zoConfig?.timestamp_column;
          const allCol = store.state.zoConfig?.all_fields_name;
          const fields: [string] =
            stream.settings?.defined_schema_fields &&
            searchObj.meta.useUserDefinedSchemas === "user_defined_schema"
              ? [
                  ...(definedFields.includes(tsCol) ? [] : [tsCol]),
                  ...definedFields,
                  ...(definedFields.includes(allCol) ? [] : [allCol]),
                ]
              : stream.schema.map((obj: { name: string; type: string }) => {
                  schemaTypeMap[obj.name] = obj.type;
                  return obj.name;
                });
          if (
            stream.settings?.defined_schema_fields &&
            searchObj.meta.useUserDefinedSchemas === "user_defined_schema"
          ) {
            stream.schema.forEach((obj: { name: string; type: string }) => {
              schemaTypeMap[obj.name] = obj.type;
            });
          }
          const ftsKeySet = new Set<string>(stream.settings.full_text_search_keys || []);
          const interestingFieldSet = new Set<string>(searchObj.data.stream.interestingFieldList);
          for (const field of fields) {
            const existing = fieldMap.get(field);
            if (existing) {
              existing.streams.push(stream.name);
              existing.isInterestingField =
                existing.isInterestingField || interestingFieldSet.has(field);
              continue;
            }
            fieldMap.set(field, {
              name: field,
              ftsKey: ftsKeySet.has(field),
              isSchemaField: true,
              group: "",
              streams: [stream.name],
              showValues: field !== timestampField && field !== allField,
              isInterestingField: interestingFieldSet.has(field),
              dataType: schemaTypeMap[field] || "",
            });
          }

          searchObj.data.hasSearchDataTimestampField =
            userDefineSchemaSettings.includes(timestampField);

          // Hit-only fields are listed for one stream without a defined schema.
          if (
            Object.prototype.hasOwnProperty.call(searchObj.data.queryResults, "hits") &&
            searchObj.data.queryResults?.hits.length > 0 &&
            searchObj.data.stream.selectedStream.length === 1 &&
            (!store.state.zoConfig.user_defined_schemas_enabled || !hasDefinedSchema)
          ) {
            const maxAttributesIndex = searchObj.data.queryResults.hits.reduce(
              (
                maxIndex: number,
                obj: Record<string, unknown>,
                currentIndex: number,
                array: Record<string, unknown>[],
              ) => {
                const numAttributes = Object.keys(obj).length;
                const maxNumAttributes = Object.keys(array[maxIndex]).length;
                return numAttributes > maxNumAttributes ? currentIndex : maxIndex;
              },
              0,
            );

            const recordwithMaxAttribute = searchObj.data.queryResults.hits[maxAttributesIndex];

            for (const key of Object.keys(recordwithMaxAttribute)) {
              if (key === "_o2_id" || key === "_original" || key === "_all_values") {
                continue;
              }
              if (key === timestampField) {
                searchObj.data.hasSearchDataTimestampField = true;
              }
              if (!fieldMap.has(key) && key !== "_stream_name") {
                fieldMap.set(key, {
                  name: key,
                  type: "Utf8",
                  ftsKey: false,
                  group: "",
                  isSchemaField: false,
                  showValues: false,
                  // Never interesting: a persisted entry would be re-added on every extract.
                  isInterestingField: false,
                  streams: [],
                  dataType: "",
                });
              }
            }
          }
          searchObj.data.stream.userDefinedSchema = userDefineSchemaSettings || [];
        }
        searchObj.meta.hasUserDefinedSchemas = hasDefinedSchema;
        const allFields = [...fieldMap.values()];
        searchObj.data.stream.interestingFieldList =
          searchObj.data.stream.interestingFieldList.filter(
            (field: string) => fieldMap.get(field)?.isInterestingField === true,
          );

        if (capturedToken !== schemaRequestToken.value) return;

        const streams = searchObj.data.stream.selectedStream;
        // Several streams group by stream; one stream groups semantically, by prefix and type when the org has no aliases.
        const rows =
          streams.length > 1
            ? applyStreamGrouping(allFields, streams, keyFieldSet, keyGroupSet, streamGroupLabels())
            : applyFieldGrouping(
                allFields,
                semanticIndex ?? buildSemanticIndex([], grouping),
                keyFieldSet,
                keyGroupSet,
              );
        searchObj.data.stream.selectedStreamFields = rows;
        bumpSeveritySchemaGeneration();
        searchObj.data.stream.selectedInterestingStreamFields = interestingRowsOf(rows);

        if (rows.length) updateFieldKeywords(rows);

        createFieldIndexMapping();
      }

      correlationFilters.restore();

      searchObjDebug["extractFieldsEndTime"] = performance.now();
      if (!regroupPass) {
        // Without cached groups every row would move when they land, so the list stays loading for them.
        searchObj.loadingFieldGroups = listWasEmpty && lateSemanticGroups?.used.length === 0;
        searchObj.loadingStream = false;
      }
      if (lateSemanticGroups) {
        regroupWhenSemanticGroupsArrive(lateSemanticGroups, capturedToken, orgId);
      }
    } catch (e: any) {
      if (!regroupPass) {
        searchObj.loadingFieldGroups = false;
        searchObj.loadingStream = false;
      }
      console.log("Error while extracting fields.", e);
      notificationMsg.value = t("search.errorWhileExtractingStreamFields");
    }
  };

  const regroupWhenSemanticGroupsArrive = (
    late: { load: Promise<FieldAlias[]>; used: FieldAlias[] },
    token: number,
    orgId: string,
  ) => {
    const holdId = ++fieldGroupsHoldId;
    const release = () => {
      if (holdId === fieldGroupsHoldId) searchObj.loadingFieldGroups = false;
    };
    const timer = searchObj.loadingFieldGroups ? setTimeout(release, FIELD_GROUPS_WAIT_MS) : null;
    void late.load
      .then(async () => {
        // fetchQuery returns the raw response; the cached copy keeps its reference when nothing changed, and survives a failed refresh.
        const aliases = getCachedSemanticGroups(orgId);
        if (!aliases?.length || aliases === late.used) return;
        if (token !== schemaRequestToken.value) return;
        // A stream or org change in flight runs its own extract, which reads these groups from the cache.
        if (searchObj.loadingStream || orgId !== store.state.selectedOrganization.identifier)
          return;
        if (!selectedSchemasLoaded()) return;
        await extractFields({ reuseLoadedSchema: true, regroupWith: aliases });
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        release();
      });
  };

  const selectedSchemasLoaded = () =>
    searchObj.data.stream.selectedStream.every((name: string) =>
      searchObj.data.streamResults.list.some(
        (stream: any) => stream.name === name && Array.isArray(stream.schema),
      ),
    );

  const loadStreamFields = async (streamName: string) => {
    try {
      if (streamName != "") {
        return await getStream(streamName, searchObj.data.stream.streamType || "logs", true);
      } else {
        searchObj.data.errorMsg = t("search.noStreamFoundInOrganization");
      }
      return;
    } catch (e: any) {
      console.log("Error while loading stream fields");
    }
  };

  /** Starts the requests extractFields() would otherwise make one after another, once the URL names the streams. */
  const prefetchSelectedStreamFields = () => {
    const streamType = searchObj.data.stream.streamType || "logs";
    void loadKeyFields();
    void loadFieldGrouping();
    if (config.isEnterprise === "true" || config.isCloud === "true") void loadSemanticGroups();
    for (const name of searchObj.data.stream.selectedStream) prefetchStreamSchema(name, streamType);
  };

  const getStreamList = async (selectStream: boolean = true, options: StreamListOptions = {}) => {
    try {
      // commented below function as we are doing resetStreamData from all the places where getStreamList is called
      // resetStreamData();
      const streamType = searchObj.data.stream.streamType || "logs";
      const requestOrg = store.state.selectedOrganization.identifier;
      const cached: any = await getStreams(streamType, false, true, options.force === true);
      const streamData = await withUnlistedRefetched(cached, streamType, requestOrg, options);
      if (store.state.selectedOrganization.identifier !== requestOrg) return;
      if (options.isCurrent && !options.isCurrent()) return;
      searchObj.data.streamResults = {
        ...streamData,
      };
      await nextTick();
      if (options.isCurrent && !options.isCurrent()) return;
      await loadStreamLists(selectStream, options);
      return;
    } catch (e: any) {
      if (e instanceof CancelledError) return;
      console.error("Error while getting stream list", e);
    }
  };

  // The list is cached for minutes, so a URL stream created since then would read as missing.
  const withUnlistedRefetched = async (
    cached: any,
    streamType: string,
    org: string,
    options: StreamListOptions,
  ) => {
    if (!options.fromUrl) return cached;
    const { missing } = pickInitialLogsStreams({
      list: cached?.list ?? [],
      current: requestedStreams(options),
      currentFromUrl: true,
      persisted: [],
      allowLatest: false,
    });
    const key = (name: string) => `${org}/${streamType}/${name}`;
    const unseen = missing.filter((name) => !refetchedMissing.has(key(name)));
    if (!unseen.length) return cached;
    try {
      await queryClient.invalidateQueries({
        queryKey: streamKeys.nameList(org, streamType),
        exact: true,
      });
      const fresh: any = await getStreams(streamType, false);
      // Marked only once a fresh list confirms the miss, so a failed or concurrent load still retries.
      const listed = new Set((fresh?.list ?? []).map((entry: { name: string }) => entry.name));
      unseen.filter((name) => !listed.has(name)).forEach((name) => refetchedMissing.add(key(name)));
      return fresh;
    } catch (e: unknown) {
      if (e instanceof CancelledError) throw e;
      return cached;
    }
  };

  const requestedStreams = (options: StreamListOptions): string[] => {
    const selected: string[] = Array.isArray(searchObj.data.stream.selectedStream)
      ? [...searchObj.data.stream.selectedStream]
      : [];
    if (options.fromUrl && !selected.length && searchObj.meta.sqlMode && searchObj.data.query) {
      return sqlSources(searchObj.data.query).sources;
    }
    return selected;
  };

  const initialStreamInput = (options: StreamListOptions): InitialStreamInput => {
    const zoConfig = store.state.zoConfig ?? {};
    const streamType = searchObj.data.stream.streamType || "logs";
    const current = requestedStreams(options);
    const legacy =
      zoConfig.query_on_stream_selection === false ||
      router?.currentRoute?.value?.query?.type === "stream_explorer";
    return {
      list: searchObj.data.streamResults.list,
      current,
      currentFromUrl: !!options.fromUrl,
      persisted: zoConfig.auto_query_enabled
        ? restoreLogsSelectedStreams(store.state.selectedOrganization?.identifier, streamType)
        : [],
      allowLatest: legacy || isGuardActive(zoConfig),
    };
  };

  const loadStreamLists = async (selectStream: boolean = true, options: StreamListOptions = {}) => {
    try {
      if (searchObj.data.streamResults.list.length > 0) {
        searchObj.data.stream.streamLists = searchObj.data.streamResults.list.map((item: any) => ({
          label: item.name,
          value: item.name,
          internal: item.is_internal === true,
        }));

        if (!selectStream) return;
        const pick = pickInitialLogsStreams(initialStreamInput(options));
        if (pick.source === "url" && pick.missing.length) {
          searchObj.data.stream.selectedStream = [];
          searchObj.data.filterErrMsg = t("search.streamNotExist").replace(
            "[STREAM_NAME]",
            pick.missing.join(", "),
          );
          return;
        }
        // A page that stays mounted keeps an earlier link's not-found message until a readable URL stream replaces it.
        if (pick.source === "url") searchObj.data.filterErrMsg = "";
        const current = searchObj.data.stream.selectedStream;
        if (
          !Array.isArray(current) ||
          current.length !== pick.selected.length ||
          current.some((name: string, i: number) => name !== pick.selected[i])
        ) {
          searchObj.data.stream.selectedStream = pick.selected;
        }
      } else {
        // A list that came back empty must not leave the previous streams in the picker.
        searchObj.data.stream.streamLists = [];
        searchObj.data.errorMsg = t("search.noStreamFoundInOrganization");
      }
      return;
    } catch (e: any) {
      console.log("Error while loading stream list");
    }
  };

  const resetFieldValues = () => {
    clearFieldValues();
  };

  const hasInterestingFieldsInLocal = (streamName: string) => {
    const localInterestingFields: any = useLocalInterestingFields();
    return (
      localInterestingFields.value != null &&
      localInterestingFields.value[searchObj.organizationIdentifier + "_" + streamName] !==
        undefined &&
      localInterestingFields.value[searchObj.organizationIdentifier + "_" + streamName].length > 0
    );
  };

  const createFieldIndexMapping = async () => {
    Promise.resolve().then(() => {
      streamSchemaFieldsIndexMapping.value = {};
      for (let i = 0; i < searchObj.data.stream.selectedStreamFields.length; i++) {
        streamSchemaFieldsIndexMapping.value[searchObj.data.stream.selectedStreamFields[i].name] =
          i;
      }
    });
  };

  const dropUnknownLinkColumns = () => {
    const known = new Set(
      (searchObj.data.stream.selectedStreamFields ?? []).map(
        (field: { name?: string }) => field?.name,
      ),
    );
    if (!known.size) return;
    const fields = searchObj.data.stream.selectedFields ?? [];
    const kept = fields.filter((name: string) => known.has(name));
    if (kept.length !== fields.length) searchObj.data.stream.selectedFields = kept;
  };

  const updateGridColumns = () => {
    try {
      searchObj.data.resultGrid.columns = [];

      const logFilterField: any =
        useLocalLogFilterField()?.value != null ? useLocalLogFilterField()?.value : {};
      const logFieldSelectedValue: any = [];
      const stream = searchObj.data.stream.selectedStream.sort().join("_");
      if (columnsFromUrl.value) dropUnknownLinkColumns();
      if (
        !columnsFromUrl.value &&
        Object.keys(logFilterField).length > 0 &&
        logFilterField[`${store.state.selectedOrganization.identifier}_${stream}`] != undefined &&
        Array.isArray(logFilterField[`${store.state.selectedOrganization.identifier}_${stream}`])
      ) {
        logFieldSelectedValue.push(
          ...logFilterField[`${store.state.selectedOrganization.identifier}_${stream}`],
        );
      }

      // In SQL mode the user's query authors the exact result columns. Neither
      // the persisted selection (logFilterField, a quick-mode convenience) nor a
      // lingering system-picked FTS default may drive SQL-mode rendering —
      // otherwise a stale "body" column overrides an explicit SELECT. When
      // entering SQL mode with a system-picked default still in memory, drop it
      // so columns come only from the query (defaulting to the raw "source").
      if (searchObj.meta.sqlMode && searchObj.meta.isFtsDefaultColumn) {
        searchObj.data.stream.selectedFields = [];
        searchObj.meta.isFtsDefaultColumn = false;
      }

      let selectedFields = searchObj.meta.sqlMode
        ? []
        : (logFilterField && logFieldSelectedValue) || [];
      selectedFields = selectedFields.filter(
        (_field: string) => _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      // Restore the persisted column selection (logFilterField) only outside SQL
      // mode (see above).
      if (
        !searchObj.meta.sqlMode &&
        searchObj.data.stream.selectedFields.length == 0 &&
        selectedFields.length > 0
      ) {
        return (searchObj.data.stream.selectedFields = selectedFields);
      }

      // As in saved view, we observed field getting duplicated in selectedFields
      // So, we are removing duplicates before applying saved view.
      // In SQL mode an explicit user pin can still populate selectedFields, but a
      // system FTS default never should (handled above).
      if (searchObj.data.stream.selectedFields?.length) {
        selectedFields = searchObj.meta.sqlMode
          ? [...searchObj.data.stream.selectedFields]
          : [...new Set(searchObj.data.stream.selectedFields)];
      }

      const parsedSQL: any = fnParsedSQL();

      // Multi-stream hits carry _stream_name; show it next to the timestamp.
      const showStreamName = shouldShowStreamNameColumn(
        searchObj.data.stream.selectedStream,
        searchObj.data.queryResults?.hits,
        selectedFields,
      );

      // By default when no fields are selected. Timestamp and Source will be visible. If user selects field, then only selected fields will be visible in table
      // In SQL and Quick mode.
      // If user adds timestamp manually then only we get it in response.
      // If we don’t add timestamp and add timestamp to table it should show invalid date.

      if (selectedFields.length == 0 || !searchObj.data.queryResults?.hits?.length) {
        searchObj.meta.resultGrid.manualRemoveFields = false;
        if (
          (searchObj.meta.sqlMode == true &&
            Object.prototype.hasOwnProperty.call(parsedSQL, "columns") &&
            Object.prototype.hasOwnProperty.call(
              searchObj.data.queryResults?.hits[0] ?? {},
              store.state.zoConfig.timestamp_column,
            )) ||
          searchObj.meta.sqlMode == false ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.push({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestampWithTimezone", { timezone: store.state.timezone }),
            header: t("search.timestampWithTimezone", { timezone: store.state.timezone }),
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            // 236 + the 24px expand gutter = the 260 the pre-migration table
            // gave the timestamp cell, which rendered the chevron INSIDE it.
            // The arrow is its own column here (so it stays put if timestamp
            // ever stops being first), so its width comes out of this budget.
            size: 236,
          });
        }

        if (showStreamName) {
          searchObj.data.resultGrid.columns.push(buildStreamNameColumn());
        }

        if (selectedFields.length == 0) {
          searchObj.data.resultGrid.columns.push({
            name: "source",
            id: "source",
            accessorFn: (row: any) => JSON.stringify(row),
            cell: (info: any) => info.getValue(),
            // "source" here, "_source" in the CorrelatedLogsTable variant — the two
            // columns are named differently on purpose; do not unify them.
            header: raw("source"),
            sortable: true,
            // Elastic: the source column fills the width left beside the
            // fixed-width timestamp column.
            resizable: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
              autoWidth: true,
            },
          });
        }
      } else {
        if (
          searchObj.data.queryResults.hits?.some((item: any) =>
            Object.prototype.hasOwnProperty.call(item, store.state.zoConfig.timestamp_column),
          ) ||
          searchObj.data.hasSearchDataTimestampField ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.unshift({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestampWithTimezone", { timezone: store.state.timezone }),
            header: t("search.timestampWithTimezone", { timezone: store.state.timezone }),
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            // 236 + the 24px expand gutter = the 260 the pre-migration table
            // gave the timestamp cell, which rendered the chevron INSIDE it.
            // The arrow is its own column here (so it stays put if timestamp
            // ever stops being first), so its width comes out of this budget.
            size: 236,
          });
        }

        if (showStreamName) {
          searchObj.data.resultGrid.columns.push(buildStreamNameColumn());
        }

        let sizes: any;
        // selectedStream array is coerced to its comma-joined string form as key
        if (
          searchObj.data.resultGrid.colSizes &&
          Object.prototype.hasOwnProperty.call(
            searchObj.data.resultGrid.colSizes,
            searchObj.data.stream.selectedStream.join(","),
          )
        ) {
          sizes =
            searchObj.data.resultGrid.colSizes[searchObj.data.stream.selectedStream.join(",")];
        }

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        for (const field of selectedFields) {
          if (field != store.state.zoConfig.timestamp_column) {
            let foundValue;

            if (sizes?.length > 0) {
              Object.keys(sizes[0]).forEach((key) => {
                const trimmedKey = key.replace(/^--(header|col)-/, "").replace(/-size$/, "");
                if (trimmedKey === field) {
                  foundValue = sizes[0][key];
                }
              });
            }

            searchObj.data.resultGrid.columns.push({
              name: field,
              id: field,
              accessorFn: (row: { [x: string]: any; source: any }) => {
                return byString(row, field);
              },
              header: field,
              sortable: true,
              enableResizing: true,
              meta: {
                closable: true,
                showWrap: true,
                wrapContent: false,
              },
              size: foundValue ? foundValue : getColumnWidth(context, field),
              maxSize: window.innerWidth,
            });
          }
        }

        // The last column absorbs the leftover width; without it the auto layout
        // spreads the surplus across EVERY column and the timestamp stretches.
        // `fillRemaining`, not a plain `autoWidth`, so it truncates at the
        // viewport instead of growing to a long `body` value.
        // `resultGrid.columns` is untyped, so `.at()` widens to `{}` — name the
        // few fields we touch rather than reaching through `any`.
        interface GridColumn {
          id: string;
          size?: number;
          minSize?: number;
          meta?: Record<string, unknown>;
        }
        const lastColumn = searchObj.data.resultGrid.columns.at(-1) as GridColumn | undefined;
        if (lastColumn && lastColumn.id !== store.state.zoConfig.timestamp_column) {
          lastColumn.minSize = lastColumn.size;
          lastColumn.meta = { ...lastColumn.meta, autoWidth: true, fillRemaining: true };
        }
      }

      extractFTSFields();
    } catch (e: any) {
      searchObj.loadingStream = false;
      notificationMsg.value = t("search.errorWhileUpdatingTableColumns");
    }
  };

  const ftsFields: any = ref([]);
  const extractFTSFields = () => {
    if (
      searchObj.data.stream.selectedStreamFields != undefined &&
      searchObj.data.stream.selectedStreamFields.length > 0
    ) {
      ftsFields.value = searchObj.data.stream.selectedStreamFields
        .filter((item: any) => item.ftsKey === true)
        .map((item: any) => item.name);
    }

    // if there is no FTS fields set by user then use default FTS fields
    if (ftsFields.value.length == 0) {
      ftsFields.value = store.state.zoConfig.default_fts_keys;
    }
  };

  const filterHitsColumns = async () => {
    searchObj.data.queryResults.filteredHit = [];
    let itemHits: any = {};
    if (searchObj.data.stream.selectedFields.length > 0) {
      searchObj.data.queryResults.hits.map((hit: any) => {
        itemHits = {};
        // searchObj.data.stream.selectedFields.forEach((field) => {
        for (const field of searchObj.data.stream.selectedFields) {
          if (Object.prototype.hasOwnProperty.call(hit, field)) {
            itemHits[field] = hit[field];
          }
        }
        itemHits[store.state.zoConfig.timestamp_column] =
          hit[store.state.zoConfig.timestamp_column];
        searchObj.data.queryResults.filteredHit.push(itemHits);
      });
    } else {
      searchObj.data.queryResults.filteredHit = searchObj.data.queryResults.hits;
    }

    await correlationFilters.save();
  };

  return {
    updateFieldValues,
    extractFields,
    prefetchSelectedStreamFields,
    loadStreamFields,
    getStreamList,
    loadStreamLists,
    resetFieldValues,
    hasInterestingFieldsInLocal,
    createFieldIndexMapping,
    updateGridColumns,
    extractFTSFields,
    filterHitsColumns,
  };
};

// Every consumer syncs the same shared query, so one watcher serves all of them for as long as any is mounted.
function retainCorrelationQueryWatcher(watchQuery: () => void): void {
  if (correlationWatcherUsers++ === 0) {
    correlationWatcherScope = effectScope(true);
    correlationWatcherScope.run(watchQuery);
  }
  if (!getCurrentScope()) return;
  onScopeDispose(() => {
    if (--correlationWatcherUsers > 0) return;
    correlationWatcherScope?.stop();
    correlationWatcherScope = null;
  });
}

export default useStreamFields;
