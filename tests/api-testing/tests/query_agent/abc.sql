"WITH extracted AS (
  SELECT
    _timestamp,
    store_nbr,
    array_extract(regexp_match(message, 'packet with generator_id (\d+)'), 1) AS generator_id,
    array_extract(regexp_match(message, 'packet_nbr (\d+)'), 1) AS packet_nbr,
    array_extract(regexp_match(message, 'packet_unique_id ([^ ]+) , packet_nbr'), 1) AS packet_unique_id
  FROM wcnp_hw_tdc_store_services
  WHERE
    cloud_rolename = 'tx-data-sender'
    AND message LIKE '%moved to failed state%'
    AND message LIKE '%file is either not found, corrupted or empty%'
    AND is_open_store = TRUE
    AND tdc_stores_open = TRUE
),
with_batch_flag AS (
  SELECT
    _timestamp,
    generator_id,
    store_nbr,
    packet_nbr,
    packet_unique_id,
    CASE
      WHEN array_extract(regexp_match(packet_unique_id, '\|(\d+)$'), 1) = packet_nbr
      THEN 'batch'
      ELSE 'non batch'
    END AS is_batch,
    concat('rxp', lpad(CAST(store_nbr AS VARCHAR), 5, '0'), '#', packet_unique_id) AS storeWithPacketUniqueId
  FROM extracted
),
recovered_status AS (
  SELECT
    wbf.generator_id,
    wbf.store_nbr,
    wbf.packet_nbr,
    wbf.packet_unique_id,
    wbf.is_batch,
    wbf.storeWithPacketUniqueId,
    CASE
      WHEN rl.log_message IS NOT NULL THEN 'received'
      ELSE 'notreceived'
    END AS ack_status
  FROM with_batch_flag wbf
  LEFT JOIN (
    SELECT log_message
    FROM wcnp_hw_tdc_prod
    WHERE _timestamp >= (EXTRACT(EPOCH FROM now() - INTERVAL '1440 MINUTE') * 1000000)
      AND _timestamp <= (EXTRACT(EPOCH FROM now()) * 1000000)
      AND kubernetes_container_name LIKE 'tx-ingestion-service-%'
      AND log_message LIKE '%Sending batch ack with status 1 for batch data with tracking ids%'
      AND log_message LIKE '%batchIdList:%'
  ) rl
    ON rl.log_message LIKE CONCAT('%batchIdList:%', wbf.packet_nbr, '%')
  WHERE wbf.is_batch = 'batch'
)
SELECT
  array_agg(
    'generator_id- ' || generator_id ||
    ', store_nbr- ' || store_nbr ||
    ', packet_nbr- ' || packet_nbr ||
    ', packet_unique_id- ' || packet_unique_id ||
    ', is_batch- ' || is_batch ||
    ', storeWithPacketUniqueId- ' || storeWithPacketUniqueId ||
    ', ack_status- ' || ack_status
  ) AS results,
  COUNT(*) AS event_count
FROM recovered_status
HAVING COUNT(*) > 0"


"SELECT SUM(trafficsum) as trafficsum,SUM(error_android) as error_android,SUM(error_ios) as error_ios,SUM(errorcount) as errorcount,SUM(errorrate) as errorrate,SUM(traffic) as traffic,SUM(traffic_android) as traffic_android,SUM(traffic_ios) as traffic_ios,o2data_errorcode,o2data_owner,o2data_upstreamerrorcode,bestmessage,mobileerrorkey,operation,platform  FROM (SELECT
0 as errorcount,
0 as trafficsum,
0 as errorrate,
(o2data_operationname) as operation,
o2data_owner,
CAST(COUNT(_timestamp) AS INT) AS traffic,

CAST(COUNT(
    CASE WHEN o2data_owner like '@openobserve-Android%'
    THEN 1 END) AS INT) AS traffic_android,

CAST(COUNT(
    CASE WHEN o2data_owner not like '@openobserve-Android%'
    THEN 1 END) AS INT) AS traffic_ios,

CAST(COUNT(
    CASE WHEN o2data_owner like '@openobserve-Android%'
    AND (o2data_upstreamerrorcode is not null OR o2data_errorcode is not null)
    THEN 1 END) AS INT) AS error_android,

CAST(COUNT(
    CASE WHEN o2data_owner not like '@openobserve-Android%'
    AND (o2data_upstreamerrorcode is not null OR o2data_errorcode is not null)
    THEN 1 END) AS INT) AS error_ios,
MAX(COALESCE(o2data_exceptionmessage, o2data_message, '')) AS bestmessage,

COALESCE(CONCAT(trim(o2data_operationname), '-', trim(o2data_upstreamerrorcode), '-',trim(o2data_errorcode)),'nil') AS mobileerrorkey,

CASE WHEN o2data_owner like '@openobserve-Android%' THEN 'Android' ELSE 'iOS' END AS platform,

MAX(CASE WHEN
re_not_match(o2data_message, '.*Gateway Timeout*.|An SSL error has occurred and a secure connection to the server cannot be made.|A data connection cannot be established since a call is currently active.|A data connection is not currently allowed.|A server with the specified hostname could not be found.|Failed to execute http call for operation *.|Failed to parse http response|The Internet connection appears to be offline.|The network connection was lost.|The request timed out.|cannot parse response|bad URL|Could not connect to the server.|International roaming is currently off.|Tempo related failure failure=glass.platform.NetworkConnectionFailure*.|Tempo related failure failure=glass.platform.ServiceFailure*.|Tempo related failure failure=glass.platform.networking.util.ApolloParseFailure*.|Tempo related failure failure=glass.platform.networking.util.NetworkTimeoutFailure*.|network not available')
THEN 1 ELSE 0 END) AS unexpectederror,
o2data_upstreamerrorcode,
o2data_errorcode

FROM openobserve_app_logs

WHERE applid = 'usoa'
AND o2data_operationname IN ('amendReservation')
AND re_match(o2data_owner, '@openobserve-ios/glass-amends-ios')

GROUP BY
operation,
platform,
o2data_upstreamerrorcode,
o2data_errorcode,
o2data_owner

HAVING
traffic > 1

ORDER BY traffic DESC
LIMIT 200) GROUP BY
o2data_errorcode,o2data_owner,o2data_upstreamerrorcode,bestmessage,mobileerrorkey,operation,platform[9:34 PM]SELECT '10-20' AS bucket, count(distinct array_extract(regexp_match(event_log, 'clientReqId:([A-Za-z0-9-]+)'), 1)) AS itemcount FROM ""wcnp_pgtax_summary"" WHERE  str_match_ignore_case(event_log, 'itemCount:') AND event_kubernetes_labels_app != 'tax-prod-b' AND CAST(array_extract(regexp_match(event_log, 'itemCount:([A-Za-z0-9-]+)'), 1) AS INT) BETWEEN 10 AND 20 UNION ALL SELECT '21-30' AS bucket, count(distinct array_extract(regexp_match(event_log, 'clientReqId:([A-Za-z0-9-]+)'), 1)) AS itemcount FROM ""wcnp_pgtax_summary"" WHERE  str_match_ignore_case(event_log, 'itemCount:') AND event_kubernetes_labels_app != 'tax-prod-b' AND CAST(array_extract(regexp_match(event_log, 'itemCount:([A-Za-z0-9-]+)'), 1) AS INT) BETWEEN 21 AND 30"

SELECT '10-20' AS bucket, count(distinct array_extract(regexp_match(event_log, 'clientReqId:([A-Za-z0-9-]+)'), 1)) AS itemcount FROM "wcnp_pgtax_summary" WHERE  str_match_ignore_case(event_log, 'itemCount:') AND event_kubernetes_labels_app != 'tax-prod-b' AND CAST(array_extract(regexp_match(event_log, 'itemCount:([A-Za-z0-9-]+)'), 1) AS INT) BETWEEN 10 AND 20 UNION ALL SELECT '21-30' AS bucket, count(distinct array_extract(regexp_match(event_log, 'clientReqId:([A-Za-z0-9-]+)'), 1)) AS itemcount FROM "wcnp_pgtax_summary" WHERE  str_match_ignore_case(event_log, 'itemCount:') AND event_kubernetes_labels_app != 'tax-prod-b' AND CAST(array_extract(regexp_match(event_log, 'itemCount:([A-Za-z0-9-]+)'), 1) AS INT) BETWEEN 21 AND 30

SELECT COUNT(_timestamp) as cnt,(CASE WHEN (json_get_str(json_get_json(log,'message'),'endpoint') = 'patientSearch' OR json_get_str(json_get_json(log,'message'),'endpoint') = 'ptntActiveTime' OR json_get_str(json_get_json(log,'message'),'endpoint') ='startWithScan') THEN null ELSE  json_get_str(json_get_json(log,'message'),'endpoint') END) as service FROM "rxonlineaccount_prod" where source_path = '/opt/tomcat8/logs/catalina.out' AND match_all('Service has been called') GROUP BY service HAVING service is not null

"SELECT
    dependency,statuscode
FROM (SELECT array_extract(regexp_match(event_log_message,'responseCode:\W(?<statuscode>[^,]+)'),1) AS statuscode,array_extract(regexp_match(event_log_message,'name: [A-Z]+\W(https:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9\/-]+)'),1) AS dependency FROM 'sams-membership-prompts' WHERE str_match_ignore_case(event_log_message, 'membership-prompt-service-stg.samsus.openobserve.com'))
GROUP BY dependency,statuscode"

SELECT spath(unnest(flatten(cast_to_arr(o2data_phases))),'name') as phasename,count(_timestamp) as count_s,spath(unnest(flatten(cast_to_arr(o2data_phases))),'startTime') as starttime FROM "openobserve_app_performance" where actionsubcateg='ar.viewInYourHome.modelPlacement' GROUP BY phasename,starttime

SELECT rtrim(ltrim(spath(array_element(cast_to_arr(event_log_message_databases),1),'cid'),'["'),'"]') as cid,count(_timestamp) as count_s FROM "wcnp_pete" where event_log_loggername='UsageFile' AND str_match_ignore_case(event_log_message_api, 'sams') GROUP BY cid