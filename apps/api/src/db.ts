import pg, {type PoolClient, type QueryResultRow} from 'pg';
import type {Config} from './config.js';

export type Tx=PoolClient;
export function makePool(config:Config):pg.Pool {
  return new pg.Pool({connectionString:config.DATABASE_URL,max:20,idleTimeoutMillis:30_000,statement_timeout:15_000,application_name:'keycalendar_api'});
}
export async function withTransaction<T>(pool:pg.Pool,fn:(tx:Tx)=>Promise<T>):Promise<T> {
  const tx=await pool.connect();
  try {await tx.query('BEGIN');const result=await fn(tx);await tx.query('COMMIT');return result;}
  catch(error){await tx.query('ROLLBACK');throw error;}
  finally{tx.release();}
}
export async function withTenant<T>(pool:pg.Pool,organizationId:string,userId:string,fn:(tx:Tx)=>Promise<T>):Promise<T> {
  return withTransaction(pool,async tx=>{
    await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[organizationId,userId]);
    return fn(tx);
  });
}
export async function withIdentity<T>(pool:pg.Pool,userId:string,fn:(tx:Tx)=>Promise<T>):Promise<T> {
  return withTransaction(pool,async tx=>{await tx.query("SELECT set_config('app.user_id',$1,true)",[userId]);return fn(tx);});
}
export async function one<T extends QueryResultRow>(tx:Tx,sql:string,params:unknown[]=[]):Promise<T|null> {
  const result=await tx.query<T>(sql,params);return result.rows[0]??null;
}
