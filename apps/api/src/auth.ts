import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import '@fastify/cookie';
import nodemailer from 'nodemailer';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import type {Config} from './config.js';
import {Problem,problem} from './problem.js';
import {one,withTransaction,type Tx} from './db.js';

export const SESSION_COOKIE='kc_session';
const SESSION_SECONDS=7*24*60*60;
export type Actor={id:string;email:string;display_name:string;session_id:string;auth_level:'password'|'mfa';session_token:string};
export function sha(data:string):Buffer{return createHash('sha256').update(data).digest();}
function opaque():string{return randomBytes(32).toString('base64url');}
function csrf(config:Config,token:string):string{return createHmac('sha256',config.CSRF_SECRET).update(token).digest('base64url');}
function equalToken(a:string,b:string):boolean{
  const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);
}
export function setSessionCookie(reply:FastifyReply,config:Config,token:string):void{
  reply.setCookie(SESSION_COOKIE,token,{httpOnly:true,secure:config.SESSION_COOKIE_SECURE==='true',sameSite:'lax',path:'/',maxAge:SESSION_SECONDS});
}
export async function getActor(req:FastifyRequest,pool:pg.Pool):Promise<Actor|null>{
  const token=req.cookies?.[SESSION_COOKIE];if(!token)return null;
  const result=await pool.query<{id:string;email:string;display_name:string;session_id:string;auth_level:'password'|'mfa'}>(
    `SELECT u.id,u.email,u.display_name,s.id AS session_id,s.auth_level FROM sessions s
     JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL
     AND s.expires_at>now() AND s.last_seen_at>now()-interval '12 hours'
     AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL`,[sha(token)]);
  const row=result.rows[0];if(row)await pool.query("UPDATE sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval '5 minutes'",[row.session_id]);return row?{...row,session_token:token}:null;
}
export async function requireActor(req:FastifyRequest,pool:pg.Pool):Promise<Actor>{
  const actor=await getActor(req,pool);if(!actor)problem(401,'SESSION_EXPIRED','Войдите в аккаунт');return actor;
}
export function requireCsrf(req:FastifyRequest,config:Config,actor:Actor):void{
  const provided=req.headers['x-csrf-token'];if(typeof provided!=='string'||!equalToken(provided,csrf(config,actor.session_token)))problem(403,'CSRF_FAILED','Повторите действие после обновления страницы');
}
export function getCsrfToken(config:Config,actor:Actor):string{return csrf(config,actor.session_token);}
async function sendIdentityMail(config:Config,to:string,subject:string,url:string):Promise<void>{
  if(config.EMAIL_DELIVERY==='development')return;
  if(config.EMAIL_DELIVERY!=='smtp'||!config.SMTP_URL||!config.MAIL_FROM)problem(503,'EMAIL_UNAVAILABLE','Отправка почты не настроена');
  const transport=nodemailer.createTransport(config.SMTP_URL);
  await transport.sendMail({from:config.MAIL_FROM,to,subject,text:`Откройте ссылку: ${url}\nЕсли вы не запрашивали письмо, просто удалите его.`});
}
async function identityToken(tx:Tx,userId:string,kind:'verify_email'|'password_reset',ttlMinutes:number):Promise<string>{
  const token=opaque();await tx.query('INSERT INTO identity_tokens(user_id,kind,token_hash,expires_at) VALUES($1,$2,$3,now()+($4::text||\' minutes\')::interval)',[userId,kind,sha(token),ttlMinutes]);return token;
}
const registration=z.object({email:z.email().max(320),password:z.string().min(12).max(1024),name:z.string().trim().min(1).max(100).optional(),display_name:z.string().trim().min(1).max(100).optional()}).strict();
const login=z.object({email:z.email(),password:z.string()}).strict();
const tokenBody=z.object({token:z.string().min(20).max(256)}).strict();
const recovery=z.object({email:z.email()}).strict();
const reset=z.object({token:z.string(),password:z.string().min(12).max(1024)}).strict();
export async function registerAuth(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.post('/api/v1/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(config.EMAIL_DELIVERY==='disabled')problem(503,'EMAIL_UNAVAILABLE','Регистрация временно недоступна');
    const input=registration.parse(req.body);const email=input.email.trim().toLowerCase();
    const passwordHash=await argon2.hash(input.password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
    const issued=await withTransaction(pool,async tx=>{
      const user=await one<{id:string}>(tx,'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',[email,input.display_name??input.name??'Пользователь',passwordHash]);
      return user?identityToken(tx,user.id,'verify_email',24*60):null;
    });
    if(issued){const url=`${config.WEB_ORIGIN}/verify-email#token=${encodeURIComponent(issued)}`;await sendIdentityMail(config,email,'Подтвердите почту для Кей Календаря',url);}
    reply.code(202).send({verification_required:true,...(issued&&config.EMAIL_DELIVERY==='development'?{verification_url:`${config.WEB_ORIGIN}/verify-email#token=${encodeURIComponent(issued)}`,verification_token:issued}:{})});
  });
  app.post('/api/v1/auth/verify-email',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{
    const {token}=tokenBody.parse(req.body);
    const result=await withTransaction(pool,async tx=>{
      const row=await one<{id:string;user_id:string}>(tx,`UPDATE identity_tokens SET used_at=now() WHERE token_hash=$1 AND kind='verify_email' AND used_at IS NULL AND expires_at>now() RETURNING id,user_id`,[sha(token)]);
      if(!row)return false;await tx.query('UPDATE users SET email_verified_at=now() WHERE id=$1 AND email_verified_at IS NULL',[row.user_id]);return true;
    });if(!result)problem(422,'VERIFICATION_EXPIRED','Ссылка недействительна или уже использована');return {verified:true};
  });
  app.post('/api/v1/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
    const input=login.parse(req.body);const email=input.email.trim().toLowerCase();
    const user=(await pool.query<{id:string;email:string;display_name:string;password_hash:string;email_verified_at:string|null}>(
      'SELECT id,email,display_name,password_hash,email_verified_at FROM users WHERE email=$1 AND disabled_at IS NULL',[email])).rows[0];
    const valid=await argon2.verify(user?.password_hash??DUMMY_HASH,input.password).catch(()=>false);
    if(!user||!valid)problem(401,'INVALID_CREDENTIALS','Не удалось войти');
    if(!user.email_verified_at)problem(403,'EMAIL_VERIFICATION_PENDING','Подтвердите почту');
    const token=opaque();const session=await withTransaction(pool,async tx=>{
      // A password reset updates the same user row. Holding this lock through
      // session creation ensures a reset cannot leave a session from the old hash.
      const current=await one<{id:string;password_hash:string;email_verified_at:string|null}>(tx,
        'SELECT id,password_hash,email_verified_at FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[user.id]);
      if(!current||current.password_hash!==user.password_hash)problem(401,'INVALID_CREDENTIALS','Не удалось войти');
      if(!current.email_verified_at)problem(403,'EMAIL_VERIFICATION_PENDING','Подтвердите почту');
      return tx.query<{id:string}>(`INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at)
        VALUES($1,$2,$3,now()+interval '7 days') RETURNING id`,[user.id,sha(token),sha(csrf(config,token))]);
    });
    setSessionCookie(reply,config,token);reply.header('Cache-Control','private, no-store');
    return {user:{id:user.id,email:user.email,display_name:user.display_name},csrf_token:csrf(config,token),session_id:session.rows[0]?.id};
  });
  const me=async(req:FastifyRequest,reply:FastifyReply)=>{
    const actor=await requireActor(req,pool);reply.header('Cache-Control','private, no-store');return {user:{id:actor.id,email:actor.email,display_name:actor.display_name},csrf_token:csrf(config,actor.session_token)};
  };
  app.get('/api/v1/auth/me',me);app.get('/api/v1/session',me);
  app.post('/api/v1/auth/logout',async(req,reply)=>{
    const actor=await requireActor(req,pool);requireCsrf(req,config,actor);
    await pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[actor.session_id]);reply.clearCookie(SESSION_COOKIE,{path:'/'});reply.code(204).send();
  });
  app.post('/api/v1/auth/recovery',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const {email}=recovery.parse(req.body);
    if(config.EMAIL_DELIVERY==='disabled')problem(503,'EMAIL_UNAVAILABLE','Восстановление временно недоступно');
    const user=(await pool.query<{id:string}>('SELECT id FROM users WHERE email=$1 AND disabled_at IS NULL',[email.toLowerCase()])).rows[0];
    let developmentUrl:string|undefined;
    if(user){const token=await withTransaction(pool,tx=>identityToken(tx,user.id,'password_reset',30));const url=`${config.WEB_ORIGIN}/reset-password#token=${encodeURIComponent(token)}`;await sendIdentityMail(config,email,'Восстановление доступа в Кей Календарь',url);if(config.EMAIL_DELIVERY==='development')developmentUrl=url;}
    reply.code(202).send({accepted:true,...(developmentUrl?{recovery_url:developmentUrl}:{})});
  });
  app.post('/api/v1/auth/verification/resend',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const {email}=recovery.parse(req.body);if(config.EMAIL_DELIVERY==='disabled')problem(503,'EMAIL_UNAVAILABLE','Отправка почты временно недоступна');
    const user=(await pool.query<{id:string}>('SELECT id FROM users WHERE email=$1 AND email_verified_at IS NULL AND disabled_at IS NULL',[email.toLowerCase()])).rows[0];
    let developmentUrl:string|undefined;
    if(user){const token=await withTransaction(pool,tx=>identityToken(tx,user.id,'verify_email',24*60));const url=`${config.WEB_ORIGIN}/verify-email#token=${encodeURIComponent(token)}`;await sendIdentityMail(config,email,'Подтвердите почту для Кей Календаря',url);if(config.EMAIL_DELIVERY==='development')developmentUrl=url;}
    reply.code(202).send({accepted:true,...(developmentUrl?{verification_url:developmentUrl}:{})});
  });
  app.post('/api/v1/auth/reset-password',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req)=>{
    const input=reset.parse(req.body);const hash=await argon2.hash(input.password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
    const changed=await withTransaction(pool,async tx=>{
      const row=await one<{user_id:string}>(tx,`UPDATE identity_tokens SET used_at=now() WHERE token_hash=$1 AND kind='password_reset' AND used_at IS NULL AND expires_at>now() RETURNING user_id`,[sha(input.token)]);
      if(!row)return false;await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1',[row.user_id,hash]);await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[row.user_id]);return true;
    });if(!changed)problem(422,'RECOVERY_EXPIRED','Ссылка недействительна или уже использована');return {changed:true};
  });
}
// A valid Argon2id hash keeps the absent-user path from trivially skipping verify.
const DUMMY_HASH=await argon2.hash('unused-valid-dummy-password',{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
