import 'dotenv/config';
import pg from 'pg';
import {CatalogImportError,importCatalog} from './import-catalog.js';

type Args={inventory:string;cards?:string;manifest?:string;organization:string;actor:string;
  mode:'preview'|'apply'};

function parseArgs(argv:string[]):Args{
  const values=new Map<string,string>();
  const allowed=new Set(['inventory','cards','manifest','organization','actor','mode']);
  for(let index=0;index<argv.length;index++){
    const flag=argv[index];
    if(!flag?.startsWith('--')||!allowed.has(flag.slice(2))||values.has(flag.slice(2)))
      throw new CatalogImportError('INVALID_ARGUMENTS');
    const value=argv[++index];
    if(!value||value.startsWith('--'))throw new CatalogImportError('INVALID_ARGUMENTS');
    values.set(flag.slice(2),value);
  }
  const inventory=values.get('inventory'),organization=values.get('organization');
  const actor=values.get('actor'),mode=values.get('mode')??'preview';
  if(!inventory||!organization||!actor||!['preview','apply'].includes(mode))
    throw new CatalogImportError('INVALID_ARGUMENTS');
  return {inventory,cards:values.get('cards'),manifest:values.get('manifest'),
    organization,actor,mode:mode as Args['mode']};
}

async function main():Promise<void>{
  const args=parseArgs(process.argv.slice(2));
  const url=process.env.IMPORT_DATABASE_URL;
  if(!url)throw new CatalogImportError('IMPORT_DATABASE_URL_REQUIRED');
  const pool=new pg.Pool({connectionString:url,max:2,
    application_name:'keycalendar_catalog_import',statement_timeout:30_000,
    connectionTimeoutMillis:10_000});
  try{
    const result=await importCatalog({pool,organizationId:args.organization,actorId:args.actor,
      inventoryPath:args.inventory,propertyCardsPath:args.cards,
      reviewManifestPath:args.manifest,mode:args.mode});
    process.stdout.write(JSON.stringify(result)+'\n');
  }finally{await pool.end();}
}

main().catch(error=>{
  // Database errors may contain a source title; emit a fixed code only.
  process.stderr.write(`Catalog import failed: ${error instanceof CatalogImportError?error.code:'INTERNAL_ERROR'}\n`);
  process.exitCode=1;
});
