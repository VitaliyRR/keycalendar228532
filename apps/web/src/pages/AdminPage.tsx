import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, itemsOf, orgPath } from '../api';
import { Badge, Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useResource } from '../components';
import { dateRu } from '../format';
import { screenPath } from '../screens';
import type { GenericRecord, Organization, Paged } from '../types';

interface ImportBatch {id:string;state:string;source_row_count?:number;quarantine_count?:number;missing_datasets?:string[];manifest_hash?:string;version?:number}
interface Job {job_id?:string;state?:string;status_url?:string}
export function MigrationPage({orgId,canPreview=false}:{orgId:string;canPreview?:boolean}) {
  const resource=useResource<Paged<ImportBatch>|ImportBatch[]>(orgPath(orgId,'import-batches'));
  const [batchId,setBatchId]=useState('');const [error,setError]=useState<unknown>(null);const [job,setJob]=useState<Job|null>(null);const [busy,setBusy]=useState(false);
  const batches=itemsOf(resource.data||[]);
  async function validate(event:FormEvent){event.preventDefault();if(!batchId)return;setBusy(true);setError(null);setJob(null);try{const result=await api<Job>(orgPath(orgId,`imports/${batchId}/validate`),{method:'POST',body:{}});setJob(result);resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  async function updateJob(){if(!job?.status_url)return;setBusy(true);setError(null);try{setJob(await api<Job>(job.status_url.replace(/^https?:\/\/[^/]+/,'').replace(/^\/api\/v1/,'')));resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  return <><PageHeader eyebrow="Перенос" title="Импорт и экспорт" description="Загруженные пакеты данных RealtyCalendar и их состояние." actions={canPreview?<Link className="button button-primary" to={screenPath(orgId,'SCR-MIG-02')}>Данные RealtyCalendar</Link>:undefined}/>
    <div className="notice notice-warning">Статусы брони, валюта и платежи требуют отдельного подтверждения. Ни заметка, ни совпадение имени не заменяют исходное основание.</div>{Boolean(error)&&<ErrorBox error={error}/>}
    <div className="two-column"><Panel title="Проверить пакет"><form className="stack-form" onSubmit={validate}><Field label="Пакет импорта"><select required value={batchId} onChange={event=>setBatchId(event.target.value)}><option value="">Выберите пакет</option>{batches.map(batch=><option value={batch.id} key={batch.id}>{batch.id.slice(0,8)} · {batch.state}</option>)}</select></Field><Button variant="primary" type="submit" disabled={!batchId||busy}>Запустить проверку</Button></form>{job&&<div className="notice notice-success" role="status"><p>Проверка запущена: {job.state||'в очереди'}.</p>{job.job_id&&<small>Задание {job.job_id}</small>}{job.status_url&&<Button onClick={()=>void updateJob()} disabled={busy}>Обновить состояние</Button>}</div>}</Panel>
      <Panel title="Загруженные пакеты">{resource.loading?<Loading/>:resource.error?<ErrorBox error={resource.error} retry={resource.reload}/>:batches.length?<div className="record-list">{batches.map(batch=><div key={batch.id} className="record-row"><div className="record-main"><strong>{batch.id.slice(0,8)}</strong><small>Строк: {batch.source_row_count??'—'} · требуют проверки: {batch.quarantine_count??'—'}</small>{batch.missing_datasets?.length?<small>Недостаёт: {batch.missing_datasets.join(', ')}</small>:null}</div><Badge state={batch.state}>{batch.state}</Badge></div>)}</div>:<Empty title="Пакетов пока нет" detail="Загрузка должна проходить через проверенный приватный механизм. Исходный клиентский экспорт не добавляется в этот репозиторий."/>}</Panel></div>
  </>;
}

interface Subscription {plan_code:string;status:string;paid_through?:string|null;active_unit_limit?:number|null;active_member_limit?:number|null;used_units?:number;used_members?:number;enabled_features?:string[]}
export function SubscriptionPage({orgId}:{orgId:string}) {
  const resource=useResource<Subscription>(orgPath(orgId,'subscription'));
  return <><PageHeader eyebrow="Организация" title="Подписка и лимиты" description="Текущий статус, доступные возможности и использование плана."/>{resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}{resource.data&&<div className="two-column"><Panel title="План"><div className="metric-large">{resource.data.plan_code}</div><Badge state={resource.data.status}>{resource.data.status}</Badge><p>Оплачено до: {resource.data.paid_through?dateRu(resource.data.paid_through):'—'}</p>{resource.data.status==='read_only'&&<div className="notice notice-warning">Доступно чтение и экспорт разрешённых данных. Обратитесь к владельцу организации для продления.</div>}</Panel><Panel title="Использование"><div className="metric-line"><span>Номера</span><strong>{resource.data.used_units??0} / {resource.data.active_unit_limit??'без лимита'}</strong></div><div className="metric-line"><span>Сотрудники</span><strong>{resource.data.used_members??0} / {resource.data.active_member_limit??'без лимита'}</strong></div><div className="chip-row">{resource.data.enabled_features?.map(feature=><span className="chip" key={feature}>{feature}</span>)}</div></Panel></div>}</>;
}

export function OrganizationPage({orgId}:{orgId:string}) {
  const resource=useResource<Organization>(`/organizations/${orgId}`);
  return <><PageHeader eyebrow="Настройки" title="Организация" description="Общие сведения выбранного рабочего пространства."/>{resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}{resource.data&&<Panel title={resource.data.display_name||resource.data.name||'Организация'}><dl className="detail-list"><dt>Часовой пояс</dt><dd>{resource.data.timezone||'—'}</dd><dt>Валюта</dt><dd>{resource.data.currency||'—'}</dd><dt>Режим</dt><dd><Badge state={resource.data.subscription_state||resource.data.lifecycle||resource.data.state}>{resource.data.subscription_state||resource.data.lifecycle||resource.data.state||'—'}</Badge></dd></dl></Panel>}</>;
}

interface StaffRecord extends GenericRecord {email?:string;role?:string;permissions?:string[];scope?:string;state?:string}
export function StaffPage({orgId}:{orgId:string}) {
  const resource=useResource<Paged<StaffRecord>|StaffRecord[]>(orgPath(orgId,'staff'));
  return <><PageHeader eyebrow="Организация" title="Сотрудники и права" description="Доступ к объектам, гостям и деньгам определяется ролью и областью назначения."/>{resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}{!resource.loading&&!resource.error&&<Panel>{itemsOf(resource.data||[]).length?<div className="record-list">{itemsOf(resource.data||[]).map(member=><div className="record-row" key={member.id}><div className="record-main"><strong>{member.name||member.email||member.id?.slice(0,8)}</strong><small>{member.scope||'Область доступа задана организацией'}</small></div><span>{member.role||'—'}</span><Badge state={member.state}>{member.state||'Активен'}</Badge></div>)}</div>:<Empty title="Сотрудников нет" detail="Добавление участника требует проверенного приглашения."/>}</Panel>}</>;
}
