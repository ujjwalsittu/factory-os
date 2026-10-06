import {randomUUID} from 'node:crypto';
import {createDb} from '@factoryos/db';
import {runSandboxOnce} from './sandbox-worker.js';
import {emailWorkerConfig,emailWorkerTransport,runConfiguredEmailOnce} from './email-worker.js';
const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is required');
const config=emailWorkerConfig(),transport=emailWorkerTransport(config),db=createDb(url,3),workerId='worker-'+randomUUID();let stopping=false;
process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
console.log('Worker ready: sandbox mock; email '+(transport?'enabled':'disabled'));
try{while(!stopping){await runSandboxOnce(db);if(!stopping)await runConfiguredEmailOnce(db,config,transport,workerId,()=>stopping);if(process.argv.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,5000));}}finally{await db.$client.end();}
