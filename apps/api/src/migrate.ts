import 'dotenv/config';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';

export async function migrate():Promise<void>{
  const connectionString=process.env.DATABASE_MIGRATE_URL;
  if(!connectionString) throw new Error('DATABASE_MIGRATE_URL required');
  const pool=new pg.Pool({connectionString,max:1});
  const client=await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)',[5096123]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const migrationDir=join(dirname(fileURLToPath(import.meta.url)),'../migrations');
    for(const name of (await readdir(migrationDir)).filter(x=>/^\d+_.*\.sql$/.test(x)).sort()){
      const sql=await readFile(join(migrationDir,name),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
      const prior=await client.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
      if(prior.rows.length){if(prior.rows[0]?.checksum!==checksum)throw new Error('Migration changed after apply: '+name);continue;}
      await client.query('BEGIN');
      try {await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');}
      catch(error){await client.query('ROLLBACK');throw error;}
    }
    const appPassword=process.env.DATABASE_APP_PASSWORD;
    if(appPassword){
      if(appPassword.length<16)throw new Error('DATABASE_APP_PASSWORD must be at least 16 characters');
      const escaped=appPassword.replaceAll("'","''");
      const exists=await client.query("SELECT 1 FROM pg_roles WHERE rolname='keycalendar_app'");
      if(!exists.rows.length)await client.query(`CREATE ROLE keycalendar_app LOGIN PASSWORD '${escaped}'`);
      else await client.query(`ALTER ROLE keycalendar_app PASSWORD '${escaped}'`);
      await client.query('GRANT USAGE ON SCHEMA public TO keycalendar_app');
      await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO keycalendar_app');
      await client.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO keycalendar_app');
      await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO keycalendar_app');
      await client.query('GRANT EXECUTE ON FUNCTION pending_ical_connections(integer) TO keycalendar_app');
    }
    process.stdout.write('Migrations applied.\n');
  }finally{
    await client.query('SELECT pg_advisory_unlock($1)',[5096123]);client.release();await pool.end();
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])migrate().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
