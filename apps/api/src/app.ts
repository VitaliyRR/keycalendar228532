import Fastify from 'fastify';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import type pg from 'pg';
import type {Config} from './config.js';
import {sendProblem} from './problem.js';
import {registerAuth} from './auth.js';
import {registerOrganizations} from './organizations.js';
import {registerInventory} from './inventory.js';
import {registerReservations} from './reservations.js';
import {registerFinance} from './finance.js';
import {registerOperations} from './operations.js';
import {registerConnections} from './connections.js';
import {registerImportPreview} from './import-preview.js';

export async function createApp(pool:pg.Pool,config:Config){
  const https=config.TLS_KEY_PATH&&config.TLS_CERT_PATH?{key:await readFile(config.TLS_KEY_PATH),cert:await readFile(config.TLS_CERT_PATH)}:undefined;
  const app=Fastify({logger:{redact:['req.headers.cookie','req.headers.authorization','req.body.password','req.body.token','req.body.feed_url','req.body.secret_ciphertext','res.headers.set-cookie'],serializers:{req:(request:{method?:string;url?:string})=>({method:request.method,url:request.url?.split(/[?#]/,1)[0]})}},bodyLimit:1_000_000,trustProxy:false,...(https?{https}:{})});
  await app.register(cookie);
  await app.register(cors,{origin:config.WEB_ORIGIN,credentials:true,allowedHeaders:['Content-Type','Accept','X-CSRF-Token','Idempotency-Key','If-Match'],methods:['GET','POST','PATCH','PUT','DELETE','OPTIONS']});
  await app.register(rateLimit,{max:300,timeWindow:'1 minute',errorResponseBuilder:()=>({status:429,code:'RATE_LIMITED',title:'Слишком много запросов. Повторите позже'})});
  app.addHook('onSend',async(_req,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");return payload;});
  app.setErrorHandler(sendProblem);
  app.get('/health/live',async()=>({status:'ok'}));
  app.get('/health/ready',async()=>{await pool.query('SELECT 1');return {status:'ok'};});
  await registerAuth(app,pool,config);
  await registerOrganizations(app,pool,config);
  await registerInventory(app,pool,config);
  await registerReservations(app,pool,config);
  await registerFinance(app,pool,config);
  await registerOperations(app,pool,config);
  await registerConnections(app,pool,config);
  await registerImportPreview(app,pool,config);
  if(config.WEB_DIST_DIR){await app.register(staticFiles,{root:resolve(config.WEB_DIST_DIR),prefix:'/',wildcard:false,decorateReply:true,maxAge:'1h'});
    app.setNotFoundHandler((req,reply)=>{if(req.method==='GET'&&!req.url.startsWith('/api/')&&!req.url.startsWith('/health/'))return reply.header('Cache-Control','no-store').sendFile('index.html');return reply.code(404).send({status:404,code:'RESOURCE_NOT_FOUND',title:'Маршрут не найден',correlation_id:req.id});});}
  return app;
}
