import {createDb} from '@factoryos/db';import {runSandboxOnce} from './sandbox-worker.js';
const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is required');const db=createDb(url,3);let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
console.log('Sandbox worker ready: mock only; NIC protocol/live access blocked');
try{while(!stopping){await runSandboxOnce(db);if(process.argv.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,5000))}}finally{await db.$client.end()}
