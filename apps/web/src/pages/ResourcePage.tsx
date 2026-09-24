import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, itemsOf, orgPath, query } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useResource } from '../components';
import { dateRu, money } from '../format';
import { screenPath, type Screen } from '../screens';
import type { GenericRecord, Paged, Property, Unit } from '../types';

export interface SourceProperty {sourceLotId:string;label:string;city:string|null;timezone:null}
export interface SourceReservation {sourceBookingId:string;sourceLotId:string|null;sourceLotLabel:string;arrivalDate:string;departureDate:string;status:string|null;amountText?:string|null;currency?:null}
export interface SourcePreview {
  mode:'source_preview';asOf:string;notice:string;
  properties:SourceProperty[];reservations:SourceReservation[];
  historicalReservations?:SourceReservation[];
  coverage:{propertyCount:number;reservationCount:number;monthlyBookingCount?:number;historicalReservationCount?:number;archivedPropertyCount?:number;clientRowCount?:number;paymentRowCount?:number;expenseRowCount?:number;depositRowCount?:number};
  clients?:{rowCount:number;sampleRows:Array<{sourceRowId:string;displayLabel:string}>};
  finance?:{
    payments?:{rowCount:number;linkedBookingCount:number;withoutBookingLinkCount:number;sampleRows:Array<{sourceRowId:string;sourceBookingId:string|null;amountText:string|null;approvedInSource:boolean|null}>};
    expenses?:{rowCount:number;sampleRows:Array<{sourceRowId:string;amountText:string|null}>};
    deposits?:{rowCount:number;sections:Array<{label:string;rowCount:number}>};
  };
}
export function useSourcePreview(orgId:string){
  const auth=useAuth();
  const role=auth.session?.memberships?.find(member=>member.organization_id===orgId)?.role||auth.organizations.find(org=>org.id===orgId)?.role;
  const allowed=role==='owner'||role==='admin';
  const resource=useResource<SourcePreview>(allowed?orgPath(orgId,'import-preview'):null);
  return {...resource,allowed};
}

type DisplayRecord = GenericRecord & { display_name?: string; title?: string; description?: string; amount_minor?: string; currency?: string; due_at?: string; created_at?: string; type?: string; provider?: string; source?: string; role?: string; entity_id?: string; resource_id?: string; target_id?: string };
function recordTitle(record:DisplayRecord) { return record.name||record.display_name||record.title||record.provider||record.description||record.type||record.id?.slice(0,8)||'Запись'; }
function recordMeta(record:DisplayRecord) { return record.due_at?`Срок: ${new Date(record.due_at).toLocaleString('ru-RU')}`:record.created_at?`Создано: ${dateRu(record.created_at)}`:record.source||record.role||''; }
function shortTime(value?:string|null) { return value?.slice(0,5)||'—'; }
function validIanaTimezone(value:string):boolean{
  if(!(value==='UTC'||/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value)))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}
  catch{return false;}
}
function timezoneSuggestions():string[]{
  try{
    const supported=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
    return [...new Set([...supported,'Europe/Moscow','Europe/Volgograd'])].sort();
  }catch{return ['Europe/Moscow','Europe/Volgograd'];}
}

export function GenericResourcePage({orgId,screen,entityId}:{orgId:string;screen:Screen;entityId?:string}) {
  const path=screen.resource==='organizations'?`/organizations/${orgId}`:orgPath(orgId,`${screen.resource||'unknown'}${entityId&&screen.resource!=='audit'?`/${encodeURIComponent(entityId)}`:''}`);
  const resource=useResource<Paged<DisplayRecord>|DisplayRecord[]|DisplayRecord>(path);
  const source=useSourcePreview(orgId);
  const records=useMemo(()=>resource.data&&Array.isArray(resource.data)?resource.data:resource.data&&'items' in resource.data?itemsOf(resource.data as Paged<DisplayRecord>):resource.data?[resource.data as DisplayRecord]:[],[resource.data]);
  const [search,setSearch]=useState('');
  const filtered=records.filter(record=>(!entityId||screen.resource!=='audit'||[record.entity_id,record.resource_id,record.target_id].includes(entityId))&&`${recordTitle(record)} ${recordMeta(record)}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  const description=screen.group==='Каналы'?'Состояние соединения показывает фактическую доставку и ошибки по провайдеру.':screen.group==='Сообщения'?'Доставленные, ожидающие и ошибочные сообщения отображаются отдельно.':screen.group==='Финансы'?'Суммы и состояние оплаты, возврата и залога учитываются отдельно.':screen.group==='Настройки'?'Доступные сведения текущей организации.':'Данные текущей организации с учётом ваших прав.';
  const preview=source.data;
  const sourceRows=screen.resource==='properties'?(preview?.properties||[]).map(item=>({id:item.sourceLotId,title:item.label,detail:item.city||'Город не указан'})):
    screen.resource==='expenses'?(preview?.finance?.expenses?.sampleRows||[]).map(item=>({id:item.sourceRowId,title:`Строка расхода ${item.sourceRowId}`,detail:item.amountText?`Сумма в источнике: ${item.amountText}`:'Сумма не указана'})):
    screen.resource==='deposits'?(preview?.finance?.deposits?.sections||[]).map(item=>({id:item.label,title:item.label,detail:`${item.rowCount.toLocaleString('ru-RU')} строк`})):[];
  const sourceTotal=screen.resource==='properties'?preview?.coverage.propertyCount:
    screen.resource==='expenses'?preview?.finance?.expenses?.rowCount??preview?.coverage.expenseRowCount:
    screen.resource==='deposits'?preview?.finance?.deposits?.rowCount??preview?.coverage.depositRowCount:undefined;
  const showSource=!entityId&&!resource.loading&&!resource.error&&records.length===0&&Boolean(sourceTotal);
  return <><PageHeader eyebrow={screen.group} title={screen.title} description={description}/><div className="toolbar"><Field label="Поиск по видимым записям"><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Название или номер"/></Field><Button onClick={resource.reload}>Обновить</Button></div>
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {!resource.loading&&!resource.error&&<Panel>{filtered.length?<div className="record-list">{filtered.map((record,index)=><div className="record-row" key={record.id||index}><div className="record-main"><strong>{recordTitle(record)}</strong><small>{recordMeta(record)}</small></div><div className="record-meta">{record.amount_minor!==undefined&&<span>{money(record.amount_minor,record.currency)}</span>}{(record.status||record.state)&&<Badge state={record.status||record.state}>{record.status||record.state}</Badge>}</div></div>)}</div>:showSource?<><div className="notice notice-warning" role="status"><strong>Предпросмотр RealtyCalendar · только чтение.</strong> В сохранённом источнике {sourceTotal?.toLocaleString('ru-RU')} строк. Эти данные ещё не стали рабочими записями Кей Календаря; значения показаны без трактовки и расчёта.</div><div className="record-list">{sourceRows.filter(item=>`${item.title} ${item.detail}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))).map(item=><div className="record-row" key={item.id}><div className="record-main"><strong>{item.title}</strong><small>{item.detail} · исходная запись</small></div></div>)}</div>{sourceRows.length===0&&<p className="muted">Доступен только общий объём исходного набора.</p>}</>:<Empty title={search?'Совпадений нет':'Записей пока нет'} detail={search?'Попробуйте другой запрос.':'В этом разделе пока нет данных для текущей организации.'}/>}</Panel>}
  </>;
}

export function PropertyPage({orgId,detailId,canWrite=true}:{orgId:string;detailId?:string;canWrite?:boolean}) {
  const resource=useResource<Paged<Property>|Property[]>(orgPath(orgId,'properties'));
  const source=useSourcePreview(orgId);
  const properties=itemsOf(resource.data||[]);
  const sourceProperties=source.data?.properties||[];
  const showSource=!detailId&&!resource.loading&&!resource.error&&properties.length===0&&sourceProperties.length>0;
  const timezones=useMemo(timezoneSuggestions,[]);
  const [showForm,setShowForm]=useState(false);const [name,setName]=useState('');const [timezone,setTimezone]=useState('');const [checkinTime,setCheckinTime]=useState('14:00');const [checkinTimeEnd,setCheckinTimeEnd]=useState('');const [checkoutTimeStart,setCheckoutTimeStart]=useState('');const [checkoutTime,setCheckoutTime]=useState('12:00');
  const [unitTarget,setUnitTarget]=useState<string|null>(null);const [unitName,setUnitName]=useState('');const [capacity,setCapacity]=useState(2);const [baseRate,setBaseRate]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>(null);
  async function createProperty(event:FormEvent){event.preventDefault();if(!validIanaTimezone(timezone))return;setBusy(true);setError(null);try{await api(orgPath(orgId,'properties'),{method:'POST',body:{name,timezone,checkin_time:checkinTime,checkin_time_end:checkinTimeEnd||undefined,checkout_time_start:checkoutTimeStart||undefined,checkout_time:checkoutTime}});setShowForm(false);setName('');resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  async function addUnit(event:FormEvent){event.preventDefault();if(!unitTarget)return;const value=baseRate.replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(value))return;const [rubles,kopecks='']=value.split('.');const base_rate_minor=(BigInt(rubles)*100n+BigInt(kopecks.padEnd(2,'0'))).toString();setBusy(true);setError(null);try{await api(orgPath(orgId,`properties/${unitTarget}/units`),{method:'POST',body:{name:unitName,capacity,base_rate_minor}});setUnitTarget(null);setUnitName('');setBaseRate('');resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  const shown=detailId?properties.filter(property=>property.id===detailId):properties;
  return <><PageHeader eyebrow="Объекты" title={detailId?'Карточка объекта':'Объекты и номера'} description="У каждого номера свои размещение, вместимость и локальные даты." actions={canWrite&&!detailId&&!showSource?<Button variant="primary" onClick={()=>setShowForm(value=>!value)}>+ Объект</Button>:undefined}/>
    {Boolean(error)&&<ErrorBox error={error}/>}
    {showForm&&<Panel title="Новый объект" className="action-panel"><form className="form-grid" onSubmit={createProperty}><Field label="Название"><input required value={name} onChange={event=>setName(event.target.value)}/></Field><Field label="Часовой пояс IANA" hint="Выберите подсказку или введите зону, например Asia/Krasnoyarsk." error={!validIanaTimezone(timezone)?'Укажите действительный часовой пояс IANA.':undefined}><input required list="property-timezones" value={timezone} onChange={event=>setTimezone(event.target.value)} spellCheck={false}/><datalist id="property-timezones">{timezones.map(zone=><option key={zone} value={zone}/>)}</datalist></Field><Field label="Заезд с"><input type="time" required value={checkinTime} onChange={event=>setCheckinTime(event.target.value)}/></Field><Field label="Заезд до (если задано)"><input type="time" min={checkinTime} value={checkinTimeEnd} onChange={event=>setCheckinTimeEnd(event.target.value)}/></Field><Field label="Выезд с (если задано)"><input type="time" max={checkoutTime} value={checkoutTimeStart} onChange={event=>setCheckoutTimeStart(event.target.value)}/></Field><Field label="Выезд до"><input type="time" required value={checkoutTime} onChange={event=>setCheckoutTime(event.target.value)}/></Field><div className="span-all inline-actions"><Button type="submit" variant="primary" disabled={busy||!validIanaTimezone(timezone)}>Сохранить объект</Button><Button type="button" onClick={()=>setShowForm(false)}>Отмена</Button></div></form></Panel>}
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {!resource.loading&&!resource.error&&shown.length===0&&!showSource&&<>{source.loading&&<Loading label="Загружаем исходные объекты…"/>}<Empty title={detailId?'Объект не найден':'Пока нет рабочих объектов'} detail={detailId?'Проверьте ссылку и права доступа.':'Исходные объекты отображаются после загрузки предпросмотра; для рабочих объектов нужна сверка.'}/></>}
    {showSource&&<><div className="notice notice-warning" role="status"><strong>Предпросмотр RealtyCalendar · только чтение.</strong> Показаны {sourceProperties.length} исходных объектов. Они ещё не созданы в рабочем фонде Кей Календаря. Часовые пояса и параметры размещения сверяются.</div><div className="property-list">{sourceProperties.map(property=><Panel key={property.sourceLotId} title={property.label} actions={<span className="muted">ID источника: {property.sourceLotId}</span>}><p className="muted">{property.city||'Город не указан'} · часовой пояс на сверке</p><p className="muted">Исходная карточка. Изменение объекта и добавление номера недоступны в предпросмотре.</p></Panel>)}</div><p className="muted"><Link to="/import-preview">Открыть полный предпросмотр импорта</Link></p></>}
    <div className="property-list">{shown.map(property=><Panel key={property.id} title={<Link to={screenPath(orgId,'SCR-OBJ-02',property.id)}>{property.name}</Link>} actions={<span className="muted">{property.timezone||'Часовой пояс не указан'}</span>}><p className="muted">Заезд с {shortTime(property.checkin_time)}{property.checkin_time_end?` до ${shortTime(property.checkin_time_end)}`:''}; выезд {property.checkout_time_start?`с ${shortTime(property.checkout_time_start)} `:''}до {shortTime(property.checkout_time)}</p><div className="unit-list">{(property.units||[]).length===0?<p className="muted">Номера пока не добавлены.</p>:(property.units||[]).map((unit:Unit)=><div className="unit-line" key={unit.id}><strong>{unit.name}</strong><span>{unit.capacity||'—'} гостей</span><Badge state={unit.state}>{unit.state||'Доступен'}</Badge></div>)}</div>{canWrite&&<div className="panel-footer"><Button onClick={()=>{setUnitTarget(property.id);setUnitName('');}}>+ Добавить номер</Button></div>}</Panel>)}</div>
    {unitTarget&&<div className="dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setUnitTarget(null);}}><section className="dialog" role="dialog" aria-modal="true" aria-label="Добавить номер"><h2>Новый номер</h2><form onSubmit={addUnit} className="stack-form"><Field label="Название номера"><input required value={unitName} onChange={event=>setUnitName(event.target.value)}/></Field><Field label="Вместимость"><input type="number" min="1" max="30" required value={capacity} onChange={event=>setCapacity(Number(event.target.value))}/></Field><Field label="Базовая цена за ночь, ₽" error={baseRate&&!/^\d+([.,]\d{1,2})?$/.test(baseRate)?'Введите сумму до копеек.':undefined}><input required inputMode="decimal" value={baseRate} onChange={event=>setBaseRate(event.target.value)}/></Field><div className="dialog-actions"><Button type="button" onClick={()=>setUnitTarget(null)}>Отмена</Button><Button variant="primary" type="submit" disabled={busy||!/^\d+([.,]\d{1,2})?$/.test(baseRate)}>Добавить</Button></div></form></section></div>}
  </>;
}

export function GuestPage({orgId,detailId,canWrite=true}:{orgId:string;detailId?:string;canWrite?:boolean}) {
  const resource=useResource<Paged<DisplayRecord>|DisplayRecord[]>(orgPath(orgId,`guests${query({})}`));
  const source=useSourcePreview(orgId);
  const guests=itemsOf(resource.data||[]);const [showForm,setShowForm]=useState(false);const [name,setName]=useState('');const [phone,setPhone]=useState('');const [email,setEmail]=useState('');const [basis,setBasis]=useState('contract');const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false);
  const sourceCount=source.data?.clients?.rowCount??source.data?.coverage.clientRowCount??0;
  const showSource=!detailId&&!resource.loading&&!resource.error&&guests.length===0&&sourceCount>0;
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError(null);try{await api(orgPath(orgId,'guests'),{method:'POST',body:{display_name:name,phone:phone||undefined,email:email||undefined,legal_basis:basis}});setShowForm(false);setName('');setPhone('');setEmail('');resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  return <><PageHeader title={detailId?'Профиль гостя':'Гости'} description="Контакты доступны только сотрудникам с разрешением. Совпадение имени не объединяет профили." actions={canWrite&&!detailId&&!showSource?<Button variant="primary" onClick={()=>setShowForm(value=>!value)}>+ Гость</Button>:undefined}/>{Boolean(error)&&<ErrorBox error={error}/>}
    {showForm&&<Panel title="Новый гость" className="action-panel"><form className="form-grid" onSubmit={submit}><Field label="Имя гостя"><input required value={name} onChange={event=>setName(event.target.value)}/></Field><Field label="Телефон"><input type="tel" value={phone} onChange={event=>setPhone(event.target.value)}/></Field><Field label="Почта"><input type="email" value={email} onChange={event=>setEmail(event.target.value)}/></Field><Field label="Основание обработки"><select value={basis} onChange={event=>setBasis(event.target.value)}><option value="contract">Исполнение договора</option><option value="consent">Согласие</option></select></Field><div className="span-all inline-actions"><Button type="submit" variant="primary" disabled={busy}>Сохранить</Button><Button type="button" onClick={()=>setShowForm(false)}>Отмена</Button></div></form></Panel>}
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}{!resource.loading&&!resource.error&&<Panel>{(detailId?guests.filter(guest=>guest.id===detailId):guests).length?<div className="record-list">{(detailId?guests.filter(guest=>guest.id===detailId):guests).map(guest=><div className="record-row" key={guest.id}><div className="record-main"><Link to={screenPath(orgId,'SCR-GST-02',guest.id||'')}>{recordTitle(guest)}</Link><small>История и документы доступны в рамках ваших прав.</small></div></div>)}</div>:showSource?<><div className="notice notice-warning" role="status"><strong>Предпросмотр RealtyCalendar · только чтение.</strong> В исходной клиентской выгрузке {sourceCount.toLocaleString('ru-RU')} строк. Гостевые профили ещё не созданы; дубли и основания обработки требуют сверки.</div><div className="record-list">{(source.data?.clients?.sampleRows||[]).map(client=><div className="record-row" key={client.sourceRowId}><div className="record-main"><strong>{client.displayLabel}</strong><small>Строка источника {client.sourceRowId} · контакты не показаны</small></div></div>)}</div><p className="muted">Показан обезличенный фрагмент. <Link to="/import-preview">Полнота исходных данных</Link>.</p></>:<Empty title={detailId?'Гость не найден':'Список гостей пуст'} detail="Проверьте права доступа или добавьте гостя."/>}</Panel>}
  </>;
}

export function TaskPage({orgId,detailId,canWrite=true,canCreate=true,role='manager'}:{orgId:string;detailId?:string;canWrite?:boolean;canCreate?:boolean;role?:string}) {
  const resource=useResource<Paged<DisplayRecord>|DisplayRecord[]>(orgPath(orgId,'tasks'));
  const properties=useResource<Paged<Property>|Property[]>(orgPath(orgId,'properties'));
  const source=useSourcePreview(orgId);
  const units=itemsOf(properties.data||[]).flatMap(property=>(property.units||[]).map(unit=>({...unit,property_name:property.name})));
  const [showForm,setShowForm]=useState(false);const [type,setType]=useState('cleaning');const [unitId,setUnitId]=useState('');const [due,setDue]=useState('');const [description,setDescription]=useState('');const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false);
  const tasks=itemsOf(resource.data||[]);const shown=detailId?tasks.filter(task=>task.id===detailId):tasks;
  const showSource=!detailId&&!resource.loading&&!resource.error&&tasks.length===0&&Boolean(source.data?.reservations.length);
  const sourceEvents=(source.data?.reservations||[]).flatMap(item=>[{id:`${item.sourceBookingId}-in`,date:item.arrivalDate,label:'Заезд',booking:item},{id:`${item.sourceBookingId}-out`,date:item.departureDate,label:'Выезд',booking:item}]).filter(item=>item.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,12);
  async function create(event:FormEvent){event.preventDefault();setBusy(true);setError(null);try{await api(orgPath(orgId,'tasks'),{method:'POST',body:{type,unit_id:unitId,due_at:new Date(due).toISOString(),description}});setShowForm(false);setDescription('');resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  async function complete(task:DisplayRecord){if(!task.id)return;setBusy(true);setError(null);try{await api(orgPath(orgId,`tasks/${task.id}/complete`),{method:'POST',version:task.version,body:{}});resource.reload();}catch(caught){setError(caught);}finally{setBusy(false);}}
  return <><PageHeader eyebrow="Операции" title={detailId?'Карточка задачи':'Задачи на сегодня'} description="Назначение, выполнение и проверка задачи имеют отдельные состояния." actions={canCreate&&!detailId&&!showSource?<Button variant="primary" onClick={()=>setShowForm(value=>!value)}>+ Задача</Button>:undefined}/>{Boolean(error)&&<ErrorBox error={error} retry={resource.reload}/>}
    {showSource&&<Panel title="Ближайшие события в исходном снимке"><div className="notice notice-warning" role="status"><strong>Предпросмотр RealtyCalendar · только чтение.</strong> Это даты броней источника, а не назначенные задачи. Уборка и исполнители ещё не перенесены.</div><div className="record-list">{sourceEvents.map(item=><div className="record-row" key={item.id}><div className="record-main"><strong>{item.label} · {item.booking.sourceLotLabel}</strong><small>{dateRu(item.date)} · бронь {item.booking.sourceBookingId}</small></div></div>)}</div>{sourceEvents.length===0&&<p className="muted">После даты снимка будущих событий не найдено.</p>}</Panel>}
    {showForm&&<Panel title="Новая задача" className="action-panel"><form className="form-grid" onSubmit={create}><Field label="Тип"><select value={type} onChange={event=>setType(event.target.value)}><option value="cleaning">Уборка</option><option value="maintenance">Поломка</option><option value="purchase">Закупка</option><option value="guest_action">Для гостя</option></select></Field><Field label="Номер"><select required value={unitId} onChange={event=>setUnitId(event.target.value)}><option value="">Выберите номер</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.property_name} · {unit.name}</option>)}</select></Field><Field label="Срок"><input type="datetime-local" required value={due} onChange={event=>setDue(event.target.value)}/></Field><Field label="Описание"><input required value={description} onChange={event=>setDescription(event.target.value)}/></Field><div className="span-all inline-actions"><Button variant="primary" type="submit" disabled={busy}>Сохранить задачу</Button><Button type="button" onClick={()=>setShowForm(false)}>Отмена</Button></div></form></Panel>}
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}{!resource.loading&&!resource.error&&<Panel>{shown.length?<div className="record-list">{shown.map(task=><div key={task.id} className="record-row"><div className="record-main"><Link to={screenPath(orgId,'SCR-OPS-03',task.id)}>{recordTitle(task)}</Link><small>{recordMeta(task)}</small></div><div className="record-meta"><Badge state={task.state}>{task.state||'—'}</Badge>{canWrite&&!['done','cancelled'].includes(task.state||'')&&!(role==='housekeeper'&&task.state==='review')&&<Button onClick={()=>void complete(task)} disabled={busy}>{role==='housekeeper'?'Передать на проверку':task.state==='review'?'Принять работу':'Завершить'}</Button>}</div></div>)}</div>:<Empty title="Задач пока нет" detail="Операции по объектам появятся здесь."/>}</Panel>}
  </>;
}
