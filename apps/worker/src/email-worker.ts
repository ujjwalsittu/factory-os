import {createSmtpTransport,loadEmailConfig,pruneEmailEvidence,runEmailOnce,type EmailConfig,type EmailTransport} from '@factoryos/email';
import type {Database} from '@factoryos/db';
export function emailWorkerConfig(){return loadEmailConfig(process.env);}
export function emailWorkerTransport(config:EmailConfig):EmailTransport|null{return config.mode==='smtp'&&config.workerEnabled?createSmtpTransport(config):null;}
export async function runConfiguredEmailOnce(db:Database,config:EmailConfig,transport:EmailTransport|null,workerId:string,shouldStop:()=>boolean=()=>false){if(!transport||shouldStop())return false;await pruneEmailEvidence(db);if(shouldStop())return false;return runEmailOnce(db,config,transport,new Date(),workerId,shouldStop);}
