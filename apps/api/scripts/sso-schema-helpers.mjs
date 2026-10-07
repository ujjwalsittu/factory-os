import {randomUUID,createHash} from 'node:crypto';
import {createDb} from '../../../packages/db/dist/index.js';
import {runMigrations} from '../../../packages/db/dist/migrate.js';
export async function isolatedSsoDatabase(migrate=true){
 const admin=createDb(process.env.DATABASE_URL),name='sso_'+randomUUID().replaceAll('-','');
 await admin.$client.query(`create database ${name}`);const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
 const db=createDb(url.toString());
 try{if(migrate)await runMigrations(url.toString());}catch(error){await db.$client.end();await admin.$client.query(`drop database ${name}`);await admin.$client.end();throw error;}
 return {db,url:url.toString(),async close(){await db.$client.end();for(let n=0;n<250;n++){if((await admin.$client.query('select count(*)::int n from pg_stat_activity where datname=$1',[name])).rows[0].n===0){await admin.$client.query(`drop database ${name}`);await admin.$client.end();return;}await new Promise(r=>setTimeout(r,20));}throw new Error('SSO fixture connections remain');}};
}
export async function seedSsoOwner(db){
 const userId=randomUUID(),sessionId=randomUUID();
 await db.$client.query('insert into "user" (id,name,email,email_verified) values ($1,$2,$3,true)',[userId,'Synthetic SSO',`${userId}@example.test`]);
 await db.$client.query('insert into session(id,user_id,token,expires_at) values ($1,$2,$3,clock_timestamp()+interval \'1 hour\')',[sessionId,userId,randomUUID()]);
 return {userId,sessionId,email:`${userId}@example.test`};
}
export async function seedSsoAction(db,owner,kind='link',target=null,patch={}){
 const id=randomUUID(),nonce=randomUUID(),provider=patch.provider??'google',issuer=patch.issuer??'https://accounts.google.com';
 await db.$client.query('insert into auth_sso_action(id,user_id,session_id,kind,provider,email_snapshot,issuer,target_account_id,nonce_hash,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval \'5 minutes\')',[id,owner.userId,owner.sessionId,kind,provider,owner.email,issuer,target,createHash('sha256').update(nonce).digest('hex')]);
 return {id,nonce,provider,issuer};
}
export async function seedSsoBinding(db,owner,action,accountKey=randomUUID()){
 const id=randomUUID();await db.$client.query('insert into account(id,user_id,provider_id,account_id,sso_issuer,sso_action_id) values($1,$2,$3,$4,$5,$6)',[id,owner.userId,action.provider,accountKey,action.issuer,action.id]);return id;
}
