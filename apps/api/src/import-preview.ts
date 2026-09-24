import {readFile,stat} from 'node:fs/promises';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import type {Config} from './config.js';
import {problem} from './problem.js';
import {inOrganization} from './tenant.js';

// An owner-only view of source facts kept separate from operational inventory,
// reservations, payments, allocations and any external synchronization.
const sourceId=z.string().min(1).max(100);
const date=z.iso.date();
const previewSchema=z.object({
  organizationId:z.uuid(),
  asOf:z.string().min(1).max(100),
  properties:z.array(z.object({
    sourceLotId:sourceId,label:z.string().min(1).max(500),
    city:z.string().max(200).nullable(),timezone:z.null()
  }).strict()).max(1000),
  reservations:z.array(z.object({
    sourceBookingId:sourceId,sourceLotId:sourceId,
    sourceLotLabel:z.string().min(1).max(500),
    arrivalDate:date,departureDate:date,
    status:z.string().min(1).max(100),
    amountText:z.string().max(100).nullable(),currency:z.null()
  }).strict()).max(2000)
}).strict();
const params=z.object({orgId:z.uuid()});
const MAX_BYTES=2*1024*1024;

export async function registerImportPreview(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.get('/api/v1/organizations/:orgId/import-preview',async(req,reply)=>{
    const {orgId}=params.parse(req.params);
    reply.header('Cache-Control','private, no-store');
    return inOrganization(req,pool,config,orgId,'import.read',async({member})=>{
      if(member.role!=='owner'&&member.role!=='admin')
        problem(403,'ACCESS_DENIED','Недостаточно прав');
      if(orgId!==config.IMPORT_PREVIEW_ORGANIZATION_ID)
        problem(404,'RESOURCE_NOT_FOUND','Запись недоступна или удалена');
      if(!config.IMPORT_PREVIEW_PATH)
        problem(503,'PREVIEW_UNAVAILABLE','Предпросмотр импорта пока не подготовлен');
      let document:unknown;
      try{
        const file=await stat(config.IMPORT_PREVIEW_PATH);
        if(!file.isFile()||file.size>MAX_BYTES)throw new Error('Invalid preview file');
        document=JSON.parse(await readFile(config.IMPORT_PREVIEW_PATH,'utf8'));
      }catch{
        problem(503,'PREVIEW_UNAVAILABLE','Предпросмотр импорта пока не подготовлен');
      }
      const parsed=previewSchema.safeParse(document);
      if(!parsed.success)
        problem(503,'PREVIEW_UNAVAILABLE','Предпросмотр импорта пока не подготовлен');
      const preview=parsed.data;
      if(preview.organizationId!==orgId)
        problem(404,'RESOURCE_NOT_FOUND','Запись недоступна или удалена');
      return {
        mode:'source_preview' as const,
        asOf:preview.asOf,
        properties:preview.properties,
        reservations:preview.reservations,
        coverage:{propertyCount:preview.properties.length,reservationCount:preview.reservations.length},
        notice:'Это сохранённые сведения RealtyCalendar для демонстрации. Объекты и брони ещё не перенесены в рабочий календарь; статус, деньги и часовые пояса требуют сверки.'
      };
    });
  });
}
