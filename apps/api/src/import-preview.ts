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
const count=z.number().int().nonnegative();
const numericText=z.string().regex(/^[-+]?\d+(?:[.,]\d+)?$/).max(100).nullable();
export const previewSchema=z.object({
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
  }).strict()).max(2000),
  // Monthly list rows have a stable booking ID and local dates, but no
  // verified status or current source lot ID. Keep them out of live bookings.
  historicalReservations:z.array(z.object({
    sourceBookingId:sourceId,sourceLotId:z.null(),
    sourceLotLabel:z.string().min(1).max(500),
    arrivalDate:date,departureDate:date,status:z.null()
  }).strict()).max(10000),
  clients:z.object({
    rowCount:count,
    sampleRows:z.array(z.object({
      sourceRowId:z.string().regex(/^clients-xlsx-row-\d+$/),
      displayLabel:z.string().regex(/^Клиент из выгрузки, строка \d+$/)
    }).strict()).max(50)
  }).strict(),
  finance:z.object({
    payments:z.object({
      rowCount:count,linkedBookingCount:count,withoutBookingLinkCount:count,
      sampleRows:z.array(z.object({
        sourceRowId:z.string().regex(/^payment-20\d\d-row-\d+$/),
        sourceBookingId:sourceId.nullable(),amountText:numericText,
        approvedInSource:z.boolean()
      }).strict()).max(100)
    }).strict(),
    expenses:z.object({
      rowCount:count,
      sampleRows:z.array(z.object({
        sourceRowId:z.string().regex(/^expenses-xlsx-row-\d+$/),
        amountText:numericText
      }).strict()).max(100)
    }).strict(),
    deposits:z.object({
      rowCount:count,
      sections:z.array(z.object({
        label:z.enum(['К возврату','Ожидают оплаты','Не внесли залог','Внесли залог']),
        rowCount:count
      }).strict()).max(20)
    }).strict()
  }).strict(),
  coverage:z.object({
    propertyCount:count,reservationCount:count,monthlyBookingCount:count,
    historicalReservationCount:count,archivedPropertyCount:count,
    clientRowCount:count,paymentRowCount:count,expenseRowCount:count,depositRowCount:count
  }).strict()
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
        problem(503,'PREVIEW_UNAVAILABLE','Данные RealtyCalendar пока недоступны');
      let document:unknown;
      try{
        const file=await stat(config.IMPORT_PREVIEW_PATH);
        if(!file.isFile()||file.size>MAX_BYTES)throw new Error('Invalid preview file');
        document=JSON.parse(await readFile(config.IMPORT_PREVIEW_PATH,'utf8'));
      }catch{
        problem(503,'PREVIEW_UNAVAILABLE','Данные RealtyCalendar пока недоступны');
      }
      const parsed=previewSchema.safeParse(document);
      if(!parsed.success)
        problem(503,'PREVIEW_UNAVAILABLE','Данные RealtyCalendar пока недоступны');
      const preview=parsed.data;
      if(preview.organizationId!==orgId)
        problem(404,'RESOURCE_NOT_FOUND','Запись недоступна или удалена');
      return {
        mode:'source_preview' as const,
        asOf:preview.asOf,
        properties:preview.properties,
        reservations:preview.reservations,
        historicalReservations:preview.historicalReservations,
        clients:preview.clients,
        finance:preview.finance,
        coverage:preview.coverage,
        notice:'Данные RealtyCalendar доступны для просмотра.'
      };
    });
  });
}
