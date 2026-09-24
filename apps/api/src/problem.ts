import type {FastifyReply, FastifyRequest} from 'fastify';
import {ZodError} from 'zod';
import {DomainError} from '@keycalendar/domain';

export class Problem extends Error {
  constructor(public readonly status:number, public readonly code:string, title:string,public readonly detail?:string,public readonly field_errors?:Record<string,string>) {super(title);this.name='Problem';}
}
export function problem(status:number,code:string,title:string,detail?:string):never {throw new Problem(status,code,title,detail);}
export function sendProblem(error:unknown,request:FastifyRequest,reply:FastifyReply):void {
  if(error instanceof ZodError){reply.status(422).send({type:'about:blank',status:422,code:'BUSINESS_RULE_FAILED',title:'Некорректные данные',field_errors:Object.fromEntries(error.issues.map(x=>[x.path.join('.'),x.message])),correlation_id:request.id});return;}
  if(error instanceof Problem){reply.status(error.status).send({type:'about:blank',status:error.status,code:error.code,title:error.message,detail:error.detail,field_errors:error.field_errors,correlation_id:request.id});return;}
  if(error instanceof DomainError){const status=error.code==='VERSION_CHANGED'||error.code==='PREVIEW_CHANGED'?412:error.code==='AVAILABILITY_CONFLICT'?409:422;reply.status(status).send({type:'about:blank',status,code:error.code,title:error.message,correlation_id:request.id});return;}
  const db=error as {code?:string;constraint?:string};
  if(db?.code==='23P01'&&db.constraint==='no_double_booking'){reply.status(409).send({type:'about:blank',status:409,code:'AVAILABILITY_CONFLICT',title:'Даты уже заняты',correlation_id:request.id});return;}
  if(db?.code==='23505'){reply.status(409).send({type:'about:blank',status:409,code:'ALREADY_EXISTS',title:'Запись уже существует',correlation_id:request.id});return;}
  request.log.error({err:error},'request failed');
  reply.status(500).send({type:'about:blank',status:500,code:'INTERNAL_ERROR',title:'Не удалось выполнить действие',correlation_id:request.id});
}
