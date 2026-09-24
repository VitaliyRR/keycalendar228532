import 'dotenv/config';
import {randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import argon2 from 'argon2';
import {z} from 'zod';
import pg from 'pg';

// First operator only. The generated password is never displayed; the owner
// receives a single use reset URL through an out-of-band channel.
const env=z.object({DATABASE_URL:z.string().url(),WEB_ORIGIN:z.string().url(),BOOTSTRAP_EMAIL:z.email(),BOOTSTRAP_RESET_FILE:z.string().min(1)}).parse(process.env);
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1});
const token=randomBytes(32).toString('base64url'),randomPassword=randomBytes(48).toString('base64url');
try{
  const passwordHash=await argon2.hash(randomPassword,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
  const client=await pool.connect();
  try{await client.query('BEGIN');
    const existing=await client.query('SELECT id FROM users WHERE email=$1',[env.BOOTSTRAP_EMAIL.toLowerCase()]);
    if(existing.rowCount)throw new Error('Bootstrap account already exists');
    const user=await client.query<{id:string}>(`INSERT INTO users(email,display_name,password_hash,email_verified_at)
      VALUES($1,'Владелец', $2,now()) RETURNING id`,[env.BOOTSTRAP_EMAIL.toLowerCase(),passwordHash]);
    await client.query(`INSERT INTO identity_tokens(user_id,kind,token_hash,expires_at)
      VALUES($1,'password_reset',$2,now()+interval '7 days')`,[user.rows[0]!.id,createHash('sha256').update(token).digest()]);
    const url=`${env.WEB_ORIGIN}/reset-password#token=${encodeURIComponent(token)}`;
    await writeFile(env.BOOTSTRAP_RESET_FILE,url+'\n',{mode:0o600,flag:'wx'});
    await client.query('COMMIT');process.stdout.write('Initial operator created; reset URL saved to protected file.\n');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}finally{await pool.end();}
