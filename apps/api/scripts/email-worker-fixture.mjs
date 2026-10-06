import {createDb} from '../../../packages/db/dist/index.js';
import {loadEmailConfig,createSmtpTransport,runEmailOnce} from '../../../packages/email/dist/index.js';
const db=createDb(process.env.DATABASE_URL,2);
try{const config=loadEmailConfig(process.env);await runEmailOnce(db,config,createSmtpTransport(config),new Date(),process.env.EMAIL_TEST_WORKER_ID);console.log('fixture worker complete');}catch{console.error('fixture worker failed');process.exitCode=1;}finally{await db.$client.end();}
