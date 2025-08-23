const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const BASE_URL = process.env.ZO_BASE_URL || 'https://main.internal.zinclabs.dev';
const USER = process.env.ZO_ROOT_USER_EMAIL;
const PASS = process.env.ZO_ROOT_USER_PASSWORD;
const ORG = 'default';

function makeRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHTTPS = urlObj.protocol === 'https:';
    const client = isHTTPS ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHTTPS ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (USER && PASS) {
      const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
      requestOptions.headers['Authorization'] = `Basic ${auth}`;
    }

    const req = client.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({ statusCode: res.statusCode, body: jsonBody, headers: res.headers });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function ingestTestData() {
  console.log('📡 Ingesting test data to OpenObserve...');
  
  const testData = JSON.parse(fs.readFileSync('./formatted-test-data.json', 'utf8'));
  
  const ingestUrl = `${BASE_URL}/api/${ORG}/${testData.stream_name}/_json`;
  
  try {
    const response = await makeRequest(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, testData.data);

    console.log(`📈 Ingestion response: ${response.statusCode}`);
    if (response.statusCode === 200) {
      console.log('✅ Test data ingested successfully!');
      console.log(`📊 Ingested ${testData.data.length} test records to stream: ${testData.stream_name}`);
    } else {
      console.log('⚠️ Ingestion response:', response.body);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error ingesting data:', error.message);
    throw error;
  }
}

async function importDashboard() {
  console.log('📋 Importing dashboard to OpenObserve...');
  
  const dashboardConfig = JSON.parse(fs.readFileSync('./poc-test-results-dashboard.json', 'utf8'));
  
  const dashboardUrl = `${BASE_URL}/api/${ORG}/dashboards`;
  
  try {
    const response = await makeRequest(dashboardUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, dashboardConfig);

    console.log(`📊 Dashboard import response: ${response.statusCode}`);
    if (response.statusCode === 200 || response.statusCode === 201) {
      console.log('✅ Dashboard imported successfully!');
      console.log(`🔗 Dashboard URL: ${BASE_URL}/web/${ORG}/dashboards`);
    } else {
      console.log('⚠️ Dashboard import response:', response.body);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Error importing dashboard:', error.message);
    throw error;
  }
}

async function uploadResults() {
  try {
    console.log('🚀 Starting OpenObserve upload...');
    console.log(`📍 Target: ${BASE_URL}`);
    console.log(`👤 User: ${USER}`);
    console.log(`🏢 Organization: ${ORG}`);
    
    // Step 1: Ingest test data
    await ingestTestData();
    
    // Step 2: Wait a moment for data to be processed
    console.log('⏳ Waiting for data processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 3: Import dashboard
    await importDashboard();
    
    console.log('\n🎉 Upload complete!');
    console.log('📊 Your POC test results are now available in OpenObserve');
    console.log(`🔗 Access dashboards at: ${BASE_URL}/web/${ORG}/dashboards`);
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  uploadResults();
}

module.exports = { uploadResults, ingestTestData, importDashboard };