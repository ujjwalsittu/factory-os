import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
const db=createDb(process.env.DATABASE_URL);
try{for(const name of ['gst_sandbox_connection','gst_sandbox_credential_revision','gst_sandbox_snapshot','gst_sandbox_operation','gst_sandbox_attempt','gst_sandbox_event','gst_sandbox_mock_remote']){const r=await db.$client.query('select to_regclass($1) as id',[name]);assert.ok(r.rows[0].id,`${name} must exist`)}console.log('PASS 7 sandbox evidence tables')}finally{await db.$client.end()}
