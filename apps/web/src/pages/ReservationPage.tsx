import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, itemsOf, orgPath, query } from '../api';
import { Badge, Button, ConfirmDialog, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useResource } from '../components';
import { addDays, dateRu, firstStay, guestName, money, nights, reservationStatus, syncStatus } from '../format';
import { screenPath } from '../screens';
import type { Paged, Property, Quote, Reservation, Unit } from '../types';
import { useSourcePreview } from './ResourcePage';

function flattenUnits(properties: Property[]): Array<Unit & {propertyName:string}> {
  return properties.flatMap(property => (property.units||[]).map(unit => ({...unit,propertyName:property.name})));
}
function defaultDate() { const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
const sourceNames:Record<string,string>={direct:'Прямое обращение',phone:'Телефон',partner:'Партнёр',other:'Другой источник'};
function quoteLineLabel(line:{kind:string;description:string}){
  const labels:Record<string,string>={lodging:'Проживание',guest_surcharge:'Доплата за гостей',length_discount:'Скидка за длительность',promo_discount:'Промокод',manual_discount:'Ручная скидка',channel_markup:'Наценка канала',service:'Услуга'};
  if(line.kind==='lodging')return line.description==='override'?'Проживание · цена на дату':line.description==='base'?'Проживание · базовая цена':`Проживание · ${line.description}`;
  return line.kind==='service'?line.description:labels[line.kind]||line.description;
}
function nightLabel(count:number){return `${count} ${count%10===1&&count%100!==11?'ночь':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'ночи':'ночей'}`;}

export function ReservationList({orgId, mode='all', canWrite=true}: {orgId:string;mode?:'all'|'arrivals';canWrite?:boolean}) {
  const navigate=useNavigate();
  const [params,setParams]=useSearchParams();
  const [search,setSearch]=useState(params.get('q')||'');
  const [status,setStatus]=useState(params.get('status')||'all');
  const [date,setDate]=useState(params.get('date')||defaultDate());
  const resource=useResource<Paged<Reservation>|Reservation[]>(orgPath(orgId,`reservations${query({status:status==='all'?undefined:status,date:mode==='arrivals'?date:undefined})}`));
  const source=useSourcePreview(orgId);
  const [sourcePage,setSourcePage]=useState(0);
  const liveReservations=itemsOf(resource.data||[]);
  const showSource=!resource.loading&&!resource.error&&liveReservations.length===0&&Boolean(source.data?.reservations.length||source.data?.historicalReservations?.length);
  const sourceRecords=useMemo(()=>{
    const all=[...(source.data?.reservations||[]),...(source.data?.historicalReservations||[])];
    const term=search.trim().toLocaleLowerCase('ru');
    const matching=all.filter(item=>[item.sourceBookingId,item.sourceLotLabel,item.status||''].some(value=>value.toLocaleLowerCase('ru').includes(term)));
    if(mode==='arrivals'){
      const onDay=matching.filter(item=>item.arrivalDate===date||item.departureDate===date);
      if(onDay.length)return onDay.sort((a,b)=>a.arrivalDate.localeCompare(b.arrivalDate));
      return matching.filter(item=>item.arrivalDate>=date||item.departureDate>=date).sort((a,b)=>a.arrivalDate.localeCompare(b.arrivalDate)).slice(0,20);
    }
    return matching.sort((a,b)=>b.arrivalDate.localeCompare(a.arrivalDate)||b.sourceBookingId.localeCompare(a.sourceBookingId));
  },[source.data,search,mode,date]);
  const sourcePageCount=Math.max(1,Math.ceil(sourceRecords.length/100));
  const currentSourcePage=Math.min(sourcePage,sourcePageCount-1);
  const visibleSource=sourceRecords.slice(currentSourcePage*100,currentSourcePage*100+100);
  const records=useMemo(()=>itemsOf(resource.data||[]).filter(res=>{
    if (mode==='arrivals' && !(res.stays||[]).some(stay=>stay.checkin===date||stay.checkout===date)) return false;
    if(status!=='all'&&res.status!==status) return false;
    const words=`${res.reference||''} ${guestName(res)} ${res.source||''}`.toLocaleLowerCase('ru');
    return words.includes(search.toLocaleLowerCase('ru'));
  }),[resource.data,mode,date,status,search]);
  function updateFilter(next:Record<string,string|null>){const value=new URLSearchParams(params);Object.entries(next).forEach(([key,part])=>part?value.set(key,part):value.delete(key));setParams(value);}
  return <>
    <PageHeader title={mode==='arrivals'?'Заезды и выезды':'Бронирования'} description={mode==='arrivals'?'План на выбранный день по местному времени объекта.':'Реестр заявок, подтверждённых и завершённых броней.'} actions={canWrite&&!showSource?<Button variant="primary" onClick={()=>navigate(screenPath(orgId,'SCR-RES-02'))}>+ Бронирование</Button>:undefined}/>
    <div className="toolbar"><Field label="Поиск"><input type="search" placeholder="Номер или гость" value={search} onChange={event=>{setSearch(event.target.value);updateFilter({q:event.target.value||null});}}/></Field><Field label="Статус"><select value={status} onChange={event=>{setStatus(event.target.value);updateFilter({status:event.target.value==='all'?null:event.target.value});}}><option value="all">Все</option><option value="request">Заявки</option><option value="confirmed">Подтверждена</option><option value="checked_in">Проживает</option><option value="checked_out">Выезд</option><option value="cancelled">Отменена</option></select></Field>{mode==='arrivals'&&<Field label="День"><input type="date" value={date} onChange={event=>{setDate(event.target.value);updateFilter({date:event.target.value});}}/></Field>}</div>
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {!resource.loading&&!resource.error&&(showSource?<><div className="notice notice-warning" role="status"><strong>Данные RealtyCalendar · только чтение.</strong> Показаны ID, объекты и даты бронирований. Доступность по этим датам не подтверждена; фильтр статуса выше к этим записям не применяется.</div><Panel title={mode==='arrivals'?'Заезды и выезды RealtyCalendar':'Брони RealtyCalendar'}>{sourceRecords.length?<><p className="muted">{mode==='arrivals'?`Событий для ${dateRu(date)}: ${sourceRecords.filter(item=>item.arrivalDate===date||item.departureDate===date).length}. ${sourceRecords.every(item=>item.arrivalDate!==date&&item.departureDate!==date)?'Ниже ближайшие сохранённые события.':''}`:`Найдено ${sourceRecords.length.toLocaleString('ru-RU')} из ${(source.data?.coverage.monthlyBookingCount??sourceRecords.length).toLocaleString('ru-RU')} ID.`}</p><div className="table-scroll"><table><caption className="sr-only">Бронирования RealtyCalendar, только чтение</caption><thead><tr><th>ID источника</th><th>Объект</th><th>Заезд</th><th>Выезд</th><th>Статус источника</th></tr></thead><tbody>{visibleSource.map(item=><tr key={item.sourceBookingId}><td><strong>{item.sourceBookingId}</strong></td><td>{item.sourceLotLabel}</td><td>{dateRu(item.arrivalDate)}</td><td>{dateRu(item.departureDate)}</td><td>{item.status||'Не установлен'}</td></tr>)}</tbody></table></div>{mode==='all'&&sourcePageCount>1&&<div className="inline-actions"><Button onClick={()=>setSourcePage(value=>Math.max(0,value-1))} disabled={currentSourcePage===0}>Назад</Button><span>Страница {currentSourcePage+1} из {sourcePageCount}</span><Button onClick={()=>setSourcePage(value=>Math.min(sourcePageCount-1,value+1))} disabled={currentSourcePage>=sourcePageCount-1}>Далее</Button></div>}</>:<Empty title="В источнике нет записей для выбранной даты или поиска" detail="Измените дату или поисковый запрос."/>}</Panel><p className="muted"><Link to="/import-preview">Состав данных RealtyCalendar</Link></p></>:<Panel><div className="table-scroll"><table><caption className="sr-only">Список бронирований</caption><thead><tr><th>Бронь</th><th>Гость</th><th>Даты</th><th>Статус</th><th>Сумма</th><th>Получено</th><th>Доставка</th></tr></thead><tbody>{records.map(res=><tr key={res.id}><td><Link to={screenPath(orgId,'SCR-RES-03',res.id)}>{res.reference||res.id.slice(0,8)}</Link></td><td>{guestName(res)}</td><td>{dateRu(firstStay(res)?.checkin)} — {dateRu(firstStay(res)?.checkout)}</td><td><Badge state={res.status}>{reservationStatus[res.status]||res.status}</Badge></td><td>{res.status==='request'?'Не рассчитана':money(res.total_minor,res.currency)}</td><td>{money(res.paid_minor,res.currency)}</td><td><Badge state={res.sync_state}>{syncStatus[res.sync_state||'']||res.sync_state||'—'}</Badge></td></tr>)}</tbody></table></div>{records.length===0&&<Empty title={search||status!=='all'?'По фильтрам ничего не найдено':'Пока нет бронирований'} detail="Измените фильтры или создайте первую запись."/>}</Panel>)}
  </>;
}

export function ReservationCreate({orgId,canWrite=true}:{orgId:string;canWrite?:boolean}) {
  const navigate=useNavigate();const [params]=useSearchParams();
  const properties=useResource<Paged<Property>|Property[]>(orgPath(orgId,'properties'));
  const guests=useResource<Paged<{id:string;display_name:string}>|Array<{id:string;display_name:string}>>(canWrite?orgPath(orgId,'guests'):null);
  const units=useMemo(()=>flattenUnits(itemsOf(properties.data||[])),[properties.data]);
  const guestOptions=itemsOf(guests.data||[]);
  const [unitId,setUnitId]=useState(params.get('unit')||'');
  const [checkin,setCheckin]=useState(params.get('checkin')||defaultDate());
  const [checkout,setCheckout]=useState(params.get('checkout')||addDays(defaultDate(),1));
  const [adults,setAdults]=useState(2);const [children,setChildren]=useState(0);
  const [guestNameInput,setGuestName]=useState('');const [guestId,setGuestId]=useState('');const [source,setSource]=useState('direct');
  const [quote,setQuote]=useState<Quote|null>(null);const [quoteError,setQuoteError]=useState<unknown>(null);
  const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false);
  const [intent,setIntent]=useState<'request'|'confirmed'|null>(null);
  const submissionKey=useRef<string|null>(null);
  const chosenUnit=units.find(unit=>unit.id===unitId);
  function invalidate(){setQuote(null);setQuoteError(null);submissionKey.current=null;}
  const invalidDate=!checkin||!checkout||checkout<=checkin;
  const capacityExceeded=Boolean((chosenUnit?.capacity&&adults+children>chosenUnit.capacity)||(chosenUnit?.capacity_adults!==undefined&&adults>chosenUnit.capacity_adults)||(chosenUnit?.capacity_children!==undefined&&children>chosenUnit.capacity_children));
  async function calculate(event?:FormEvent){event?.preventDefault();setQuote(null);setQuoteError(null);if(invalidDate||!unitId||capacityExceeded)return;setBusy(true);try{const result=await api<Quote>(orgPath(orgId,'quotes'),{method:'POST',body:{unit_id:unitId,checkin,checkout,adults,children,source}});setQuote(result);}catch(caught){setQuoteError(caught);}finally{setBusy(false);}}
  async function submit(status:'request'|'confirmed'){
    setError(null);
    if(!canWrite||!unitId||invalidDate||(!guestId&&!guestNameInput.trim())||capacityExceeded)return;
    if(status==='confirmed'&&(!quote||new Date(quote.expires_at).getTime()<=Date.now())){setQuoteError(new ApiError({status:412,code:'PREVIEW_EXPIRED',title:'Рассчитайте цену ещё раз'}));return;}
    setBusy(true);
    const key=submissionKey.current||crypto.randomUUID();submissionKey.current=key;
    try{const created=await api<Reservation>(orgPath(orgId,'reservations'),{method:'POST',idempotencyKey:key,body:{unit_id:unitId,guest_id:guestId||undefined,guest_name:guestId?undefined:guestNameInput.trim(),checkin,checkout,adults,children,source,status,quote_id:status==='confirmed'?quote?.id:undefined}});submissionKey.current=null;navigate(screenPath(orgId,'SCR-RES-03',created.id));}
    catch(caught){setError(caught);if(caught instanceof ApiError&&[409,412].includes(caught.status)){setQuote(null);submissionKey.current=null;}}finally{setBusy(false);setIntent(null);}
  }
  return <>
    <PageHeader title="Новое бронирование" description="Заявка оставляет даты свободными. Подтверждение повторно проверяет занятость и цену."/>
    {!canWrite&&<div className="notice">Доступно только чтение. Для создания нужна роль с правом бронирования.</div>}
    {properties.loading&&<Loading/>}{Boolean(properties.error)&&<ErrorBox error={properties.error} retry={properties.reload}/>}
    {!properties.loading&&!properties.error&&units.length===0&&<Empty title="Добавьте объект и номер" detail="Для бронирования требуется размещаемая единица." action={<Link className="button button-primary" to={screenPath(orgId,'SCR-OBJ-01')}>Открыть объекты</Link>}/>}
    {units.length>0&&<div className="two-column"><Panel title="Проживание"><form className="form-grid" onSubmit={calculate}>
      {Boolean(error)&&<div className="span-all"><ErrorBox error={error} retry={()=>{invalidate();}}/></div>}
      <Field label="Объект / номер" error={(error instanceof ApiError ? error.fieldErrors?.find(item=>item.path==='unit_id')?.message : undefined)}><select value={unitId} required onChange={event=>{setUnitId(event.target.value);invalidate();}}><option value="">Выберите номер</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.propertyName} · {unit.name}{unit.capacity?` · до ${unit.capacity} гостей`:''}</option>)}</select></Field>
      <Field label="Источник"><select value={source} onChange={event=>{setSource(event.target.value);invalidate();}}><option value="direct">Прямое обращение</option><option value="phone">Телефон</option><option value="partner">Партнёр</option><option value="other">Другой</option></select></Field>
      <Field label="Заезд"><input type="date" required value={checkin} onChange={event=>{setCheckin(event.target.value);invalidate();}}/></Field><Field label="Выезд" error={invalidDate?'Выезд должен быть позже заезда.':undefined}><input type="date" required min={addDays(checkin,1)} value={checkout} onChange={event=>{setCheckout(event.target.value);invalidate();}}/></Field>
      <Field label="Взрослые"><input type="number" min="1" max="30" value={adults} onChange={event=>{setAdults(Number(event.target.value));invalidate();}}/></Field><Field label="Дети" error={capacityExceeded?'Превышена вместимость номера.':undefined}><input type="number" min="0" max="30" value={children} onChange={event=>{setChildren(Number(event.target.value));invalidate();}}/></Field>
      <Field label="Гость" className="span-all"><select value={guestId} onChange={event=>{setGuestId(event.target.value);submissionKey.current=null;}}><option value="">Новый гость — ввести имя</option>{guestOptions.map(guest=><option value={guest.id} key={guest.id}>{guest.display_name}</option>)}</select></Field>
      {!guestId&&<Field label="Имя гостя" className="span-all"><input value={guestNameInput} required maxLength={160} onChange={event=>{setGuestName(event.target.value);submissionKey.current=null;}} placeholder="Как указано в обращении"/></Field>}
      {guests.loading&&<div className="span-all muted">Загружаем доступных гостей…</div>}
      {Boolean(guests.error)&&<div className="span-all"><ErrorBox error={guests.error} retry={guests.reload}/></div>}
      <div className="span-all inline-actions"><Button type="submit" disabled={busy||invalidDate||!unitId||capacityExceeded}>Рассчитать цену</Button><span className="muted">{!invalidDate?nightLabel(nights(checkin,checkout)):'Проверьте даты'}</span></div>
    </form></Panel><Panel title="Расчёт и результат">
      {Boolean(quoteError)&&<ErrorBox error={quoteError} retry={()=>{void calculate();}}/>}
      {quote?<><div className="quote-total"><span>Стоимость проживания</span><strong>{money(quote.total_minor,quote.currency)}</strong></div><p className="muted">Расчёт действителен до {new Date(quote.expires_at).toLocaleString('ru-RU')}.</p><ul className="quote-lines">{quote.lines?.map((line,index)=><li key={index}><span>{line.date?`${dateRu(line.date)} · `:''}{quoteLineLabel(line)}</span><strong>{money(line.total_minor,quote.currency)}</strong></li>)}</ul>{quote.restrictions?.length?<div className="notice notice-warning">{quote.restrictions.join(' · ')}</div>:null}</>:<div className="empty compact"><strong>Цена ещё не рассчитана</strong><p>Выберите номер, даты и состав гостей.</p></div>}
      <p className="muted">Залог и принятые платежи учитываются отдельно от стоимости проживания.</p><div className="submit-stack"><Button type="button" onClick={()=>setIntent('request')} disabled={!canWrite||busy||!unitId||invalidDate||capacityExceeded||(!guestId&&!guestNameInput.trim())}>Сохранить заявку</Button><Button variant="primary" type="button" onClick={()=>setIntent('confirmed')} disabled={!canWrite||busy||!quote||(!guestId&&!guestNameInput.trim())}>Подтвердить бронь</Button></div>
    </Panel></div>}
    {intent&&<ConfirmDialog title={intent==='request'?'Сохранить заявку?':'Подтвердить бронь?'} description={<p>{intent==='request'?'Заявка не займёт номер. Перед подтверждением потребуется новая проверка.':'Даты будут заняты после успешного сохранения на сервере. Доставка на внешние каналы выполняется отдельно.'}</p>} onCancel={()=>setIntent(null)} onConfirm={()=>void submit(intent)} busy={busy} confirmLabel={intent==='request'?'Сохранить заявку':'Подтвердить бронь'}/>}
  </>;
}

interface FinancialPreview { id?:string;hash?:string;preview_id?:string;preview_hash?:string;new_total_minor?:string;refundable_minor?:string;fee_minor?:string;currency?:string;expires_at?:string;summary?:string; }
export function ReservationDetail({orgId,reservationId,canWrite=true}:{orgId:string;reservationId:string;canWrite?:boolean}) {
  const resource=useResource<Reservation>(orgPath(orgId,`reservations/${encodeURIComponent(reservationId)}`));
  const properties=useResource<Paged<Property>|Property[]>(orgPath(orgId,'properties'));
  const units=useMemo(()=>flattenUnits(itemsOf(properties.data||[])),[properties.data]);
  const [mode,setMode]=useState<'view'|'move'|'cancel'>('view');
  const [unitId,setUnitId]=useState('');const [checkin,setCheckin]=useState('');const [checkout,setCheckout]=useState('');const [reason,setReason]=useState('');
  const [quote,setQuote]=useState<Quote|null>(null);const [preview,setPreview]=useState<FinancialPreview|null>(null);
  const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false);const mutationKey=useRef<string|null>(null);
  const res=resource.data;const stay=res?firstStay(res):undefined;
  function beginMove(){if(!res||!stay)return;setUnitId(stay.unit_id);setCheckin(stay.checkin);setCheckout(stay.checkout);setReason('');setQuote(null);setError(null);setMode('move');}
  async function previewMove(){if(!res||!unitId||!checkin||!checkout||checkout<=checkin)return;mutationKey.current=null;setBusy(true);setError(null);try{const result=await api<Quote>(orgPath(orgId,'quotes'),{method:'POST',body:{unit_id:unitId,checkin,checkout,adults:stay?.adults??1,children:stay?.children??0,source:res.source||'direct'}});setQuote(result);}catch(caught){setError(caught);}finally{setBusy(false);}}
  async function commitMove(){if(!res||!quote||!reason.trim())return;setBusy(true);setError(null);const key=mutationKey.current||crypto.randomUUID();mutationKey.current=key;try{await api(orgPath(orgId,`reservations/${res.id}`),{method:'PATCH',version:res.version,idempotencyKey:key,body:{unit_id:unitId,checkin,checkout,reason:reason.trim(),quote_id:quote.id}});mutationKey.current=null;setMode('view');resource.reload();}catch(caught){setError(caught);if(caught instanceof ApiError&&[409,412].includes(caught.status)){setQuote(null);mutationKey.current=null;resource.reload();}}finally{setBusy(false);}}
  async function beginCancel(){if(!res)return;mutationKey.current=null;setBusy(true);setError(null);setReason('');try{const result=await api<FinancialPreview>(orgPath(orgId,`reservations/${res.id}/financial-preview`),{method:'POST',body:{action:'cancel'}});setPreview(result);setMode('cancel');}catch(caught){setError(caught);}finally{setBusy(false);}}
  async function commitCancel(){if(!res||!preview||!reason.trim())return;setBusy(true);setError(null);const key=mutationKey.current||crypto.randomUUID();mutationKey.current=key;try{await api(orgPath(orgId,`reservations/${res.id}/cancel`),{method:'POST',version:res.version,idempotencyKey:key,body:{preview_id:preview.preview_id||preview.id,preview_hash:preview.preview_hash||preview.hash,reason:reason.trim()}});mutationKey.current=null;setMode('view');resource.reload();}catch(caught){setError(caught);if(caught instanceof ApiError&&[409,412].includes(caught.status)){setPreview(null);setMode('view');mutationKey.current=null;resource.reload();}}finally{setBusy(false);}}
  return <>
    <PageHeader eyebrow="Бронирование" title={res?.reference||'Карточка бронирования'} description="Проживание, деньги и доставка меняют состояние независимо." actions={<Link className="button button-secondary" to={screenPath(orgId,'SCR-RES-01')}>К реестру</Link>}/>
    {resource.loading&&<Loading/>}{Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {res&&<><div className="detail-summary"><Badge state={res.status}>{reservationStatus[res.status]||res.status}</Badge><Badge state={res.sync_state}>{syncStatus[res.sync_state||'']||res.sync_state||'—'}</Badge>{res.archived_at&&<Badge state="warning">В архиве</Badge>}</div>
      <div className="three-column"><Panel title="Проживание"><dl className="detail-list"><dt>Гость</dt><dd>{guestName(res)}</dd><dt>Номер</dt><dd>{units.find(unit=>unit.id===stay?.unit_id)?.name||stay?.unit_id||'—'}</dd><dt>Заезд</dt><dd>{dateRu(stay?.checkin)}</dd><dt>Выезд</dt><dd>{dateRu(stay?.checkout)}</dd><dt>Ночей</dt><dd>{stay?nights(stay.checkin,stay.checkout):'—'}</dd><dt>Источник</dt><dd>{sourceNames[res.source||'']||res.source||'—'}</dd></dl></Panel><Panel title="Деньги"><dl className="detail-list"><dt>Стоимость</dt><dd>{res.status==='request'?'Не рассчитана':money(res.total_minor,res.currency)}</dd><dt>Получено</dt><dd>{money(res.paid_minor,res.currency)}</dd><dt>Залог</dt><dd>{money(res.deposit_held_minor,res.currency)}</dd></dl><p className="muted">Оплата и возврат оформляются отдельными действиями.</p></Panel><Panel title="Действия"><div className="stack-actions"><Button onClick={beginMove} disabled={!canWrite||!stay||res.status==='cancelled'}>Изменить проживание</Button><Button variant="danger" onClick={()=>void beginCancel()} disabled={!canWrite||res.status==='cancelled'||busy}>Рассчитать отмену</Button><Link className="button button-secondary" to={screenPath(orgId,'SCR-RES-05',res.id)}>История изменений</Link></div></Panel></div>
      {Boolean(error)&&<ErrorBox error={error} retry={resource.reload}/>}
      {mode==='move'&&<Panel title="Изменить проживание" className="action-panel"><div className="form-grid"><Field label="Номер"><select value={unitId} onChange={event=>{setUnitId(event.target.value);setQuote(null);mutationKey.current=null;}}>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.propertyName} · {unit.name}</option>)}</select></Field><Field label="Причина"><input value={reason} onChange={event=>setReason(event.target.value)} placeholder="Для истории изменений"/></Field><Field label="Новый заезд"><input type="date" value={checkin} onChange={event=>{setCheckin(event.target.value);setQuote(null);mutationKey.current=null;}}/></Field><Field label="Новый выезд"><input type="date" min={addDays(checkin,1)} value={checkout} onChange={event=>{setCheckout(event.target.value);setQuote(null);mutationKey.current=null;}}/></Field></div><div className="inline-actions"><Button onClick={()=>void previewMove()} disabled={busy||!unitId||!checkin||checkout<=checkin}>Рассчитать изменение</Button>{quote&&<strong>Новая цена: {money(quote.total_minor,quote.currency)}</strong>}</div><p className="muted">Расчёт показывает цену до сохранения. Смена дат проверяется сервером повторно.</p><div className="inline-actions"><Button onClick={()=>setMode('view')}>Вернуться</Button><Button variant="primary" onClick={()=>void commitMove()} disabled={busy||!quote||!reason.trim()}>Подтвердить изменение</Button></div></Panel>}
      {mode==='cancel'&&preview&&<Panel title="Расчёт отмены" className="action-panel"><p>{preview.summary||'Проверьте финансовый результат отмены перед подтверждением.'}</p><dl className="detail-list"><dt>Новая стоимость</dt><dd>{money(preview.new_total_minor,preview.currency||res.currency)}</dd><dt>Удержание</dt><dd>{money(preview.fee_minor,preview.currency||res.currency)}</dd><dt>Возможный возврат</dt><dd>{money(preview.refundable_minor,preview.currency||res.currency)}</dd></dl><Field label="Причина отмены"><textarea value={reason} onChange={event=>setReason(event.target.value)} rows={3} required/></Field><p className="muted">Возврат денег после отмены оформляется отдельно. Для внешней брони состояние канала проверяется отдельно.</p><div className="inline-actions"><Button onClick={()=>setMode('view')}>Вернуться</Button><Button variant="danger" onClick={()=>void commitCancel()} disabled={busy||!reason.trim()}>Подтвердить отмену</Button></div></Panel>}
    </>}
  </>;
}
