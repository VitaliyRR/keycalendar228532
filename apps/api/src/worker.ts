import {loadConfig} from './config.js';
import {makePool} from './db.js';
import {pollIcalConnection} from './connections-worker.js';

const config=loadConfig(),pool=makePool(config);let running=true;
async function cycle(){
  const due=await pool.query<{organization_id:string;connection_id:string;actor_id:string}>('SELECT * FROM pending_ical_connections($1)',[10]);
  for(const row of due.rows){if(!running)break;
    try{await pollIcalConnection(pool,config,{organizationId:row.organization_id,connectionId:row.connection_id,actorId:row.actor_id});}
    catch(error){const code=error&&typeof error==='object'&&'code' in error?String((error as {code:unknown}).code):'POLL_FAILED';process.stderr.write(`iCal poll ${row.connection_id}: ${code}\n`);}
  }
}
async function run(){while(running){try{await cycle();}catch(error){process.stderr.write(`worker cycle: ${error instanceof Error?error.name:'ERROR'}\n`);}
    if(!running)break;await new Promise<void>(resolve=>setTimeout(resolve,60_000));}}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{running=false;void pool.end();});
await run();
