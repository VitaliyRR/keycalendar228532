import {loadConfig} from './config.js';
import {makePool} from './db.js';
import {createApp} from './app.js';

const config=loadConfig();const pool=makePool(config);const app=await createApp(pool,config);
try{await app.listen({host:config.HOST,port:config.PORT});}
catch(error){app.log.error({err:error},'Failed to start');await pool.end();process.exitCode=1;}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>pool.end()).finally(()=>process.exit());});
