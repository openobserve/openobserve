#!/usr/bin/env node
/**
 * Script to clean up leftover test dashboards using API
 */
require('dotenv').config();
const APICleanup = require('../pages/apiCleanup.js');

async function main() {
    console.log('Starting dashboard cleanup...');
    console.log('Base URL:', process.env.ZO_BASE_URL);
    console.log('Org:', process.env.ORGNAME);
    console.log('User:', process.env.ZO_ROOT_USER_EMAIL);

    const cleanup = new APICleanup();

    try {
        const result = await cleanup.cleanupDashboards();
        console.log('Cleanup result:', result);
    } catch (error) {
        console.error('Cleanup failed:', error.message);
        process.exit(1);
    }
}

main();
