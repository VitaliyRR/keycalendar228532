import 'dotenv/config';
import pg from 'pg';
import {stageSnapshot,StageError,type EvidenceDataset} from './import-stage0.js';

type Args={input:string;original:string;manifest:string;organization:string;actor:string;
  worksheet?:string;dataset:EvidenceDataset;mode:'dry-run'|'stage'};

function argsFromCommandLine(argv:string[]):Args{
  const values=new Map<string,string>();
  const allowed=new Set(['input','original','manifest','organization','actor','worksheet','dataset','mode']);
  for(let index=0;index<argv.length;index++){
    const flag=argv[index];
    if(!flag?.startsWith('--')||!allowed.has(flag.slice(2))||values.has(flag.slice(2)))
      throw new StageError('INVALID_ARGUMENTS');
    const value=argv[++index];
    if(!value||value.startsWith('--'))throw new StageError('INVALID_ARGUMENTS');
    values.set(flag.slice(2),value);
  }
  const input=values.get('input'),original=values.get('original'),manifest=values.get('manifest');
  const organization=values.get('organization'),actor=values.get('actor');
  const mode=values.get('mode')??'dry-run';
  const dataset=values.get('dataset')??'bookings';
  if(!input||!original||!manifest||!organization||!actor||!['dry-run','stage'].includes(mode)||
    !['bookings','clients','expenses','payments_ui','inventory_ui','deposits_ui','settings_ui',
      'properties_full_ui','active_booking_cards_ui','booking_card_facts_ui',
      'booking_pages_ui','property_edit_links_ui'].includes(dataset))
    throw new StageError('INVALID_ARGUMENTS');
  return {input,original,manifest,organization,actor,worksheet:values.get('worksheet'),
    dataset:dataset as EvidenceDataset,mode:mode as Args['mode']};
}

async function main():Promise<void>{
  const args=argsFromCommandLine(process.argv.slice(2));
  const url=process.env.IMPORT_DATABASE_URL;
  if(!url)throw new StageError('IMPORT_DATABASE_URL_REQUIRED');
  const keyHex=process.env.IMPORT_STAGING_KEY_HEX;
  if(args.mode==='stage'&&(!keyHex||!/^[a-f0-9]{64}$/i.test(keyHex)))
    throw new StageError('IMPORT_STAGING_KEY_REQUIRED');
  const pool=new pg.Pool({connectionString:url,max:2,application_name:'keycalendar_stage0_import',
    statement_timeout:30_000,connectionTimeoutMillis:10_000});
  try{
    const report=await stageSnapshot({pool,organizationId:args.organization,actorId:args.actor,
      manifestPath:args.manifest,originalPath:args.original,jsonlPath:args.input,
      worksheet:args.worksheet,dataset:args.dataset,dryRun:args.mode==='dry-run',
      encryptionKey:keyHex?Buffer.from(keyHex,'hex'):undefined});
    process.stdout.write(JSON.stringify(report)+'\n');
  }finally{await pool.end();}
}

main().catch(error=>{
  // Database errors can contain a rejected source value. Never print them or
  // command-line arguments in a terminal log.
  process.stderr.write(`Staging failed: ${error instanceof StageError?error.code:'INTERNAL_ERROR'}\n`);
  process.exitCode=1;
});
