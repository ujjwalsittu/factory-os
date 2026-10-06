import {randomUUID,createHash} from 'node:crypto';
import {createDb} from '../../../packages/db/dist/index.js';
export const fixtureClock=new Date('2026-10-06T00:00:00Z');
export async function emailFixture(){
 const db=createDb(process.env.DATABASE_URL),id=randomUUID();
 await db.$client.query('insert into "user" (id,name,email) values ($1,$2,$3)',[id,'Email fixture',`${id}@example.test`]);
 const tenant=(await db.$client.query('insert into tenant (name,slug) values ($1,$2) returning id',['Email fixture',id])).rows[0].id;
 const invitation=(await db.$client.query("insert into invitation (tenant_id,email,token_hash,roles,invited_by,expires_at) values ($1,$2,$3,'[]',$4,$5) returning id",[tenant,`${id}@example.test`,createHash('sha256').update(id).digest('hex'),id,new Date(fixtureClock.getTime()+86400000)])).rows[0].id;
 return {db,userId:id,tenantId:tenant,invitationId:invitation,smtp:{messages:[]},async close(){await db.$client.end();}};
}
export async function fixtureSourceSnapshot(db,tenantId){
 const tables=['tenant','role','uom','hsn_code','membership','role_assignment','invitation','audit_event','email_delivery'];
 const result={};for(const table of tables)result[table]=(await db.$client.query(`select * from ${table} where ${table==='tenant'?'id':'tenant_id'}=$1 order by ${table==='audit_event'?'seq':'id'}`,[tenantId])).rows;
 return result;
}
/** Wait for physical backend closure before dropping; never terminate an idle test pool. */
export async function closeEmailDatabase(admin,databaseName){
 if(!/^email_[a-z_]+_[a-f0-9]{32}$/.test(databaseName))throw new Error('Invalid fixture database');
 for(let i=0;i<250;i++){const active=(await admin.$client.query('select count(*)::int n from pg_stat_activity where datname=$1',[databaseName])).rows[0].n;if(active===0){await admin.$client.query(`drop database ${databaseName}`);return;}await new Promise(resolve=>setTimeout(resolve,20));}
 throw new Error('Fixture database still has active connections');
}
