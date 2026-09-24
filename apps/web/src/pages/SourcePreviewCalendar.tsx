import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { orgPath } from '../api';
import { Button, Empty, ErrorBox, Loading, Panel, useResource } from '../components';
import { dateRu, nights } from '../format';

const CELL_WIDTH=79;
const LABEL_WIDTH=244;
const DAY_COUNT=14;

interface SourceProperty {sourceLotId:string;label:string;city:string|null;timezone:null}
interface SourceReservation {sourceBookingId:string;sourceLotId:string;sourceLotLabel:string;arrivalDate:string;departureDate:string;status:string;amountText:string|null;currency:null}
interface SourcePreview {
  mode:'source_preview';asOf:string;
  properties:SourceProperty[];reservations:SourceReservation[];
  coverage:{propertyCount:number;reservationCount:number};notice:string;
}

function intersects(item:SourceReservation,start:string,end:string){return item.arrivalDate<end&&item.departureDate>start;}

export function SourcePreviewCalendar({orgId,start,end,days,search,explicitStart,onJump}:{orgId:string;start:string;end:string;days:string[];search:string;explicitStart:boolean;onJump:(day:string)=>void}) {
  const resource=useResource<SourcePreview>(orgPath(orgId,'import-preview'));
  const data=resource.data;
  const bookings=useMemo(()=>[...(data?.reservations||[])].sort((a,b)=>a.arrivalDate.localeCompare(b.arrivalDate)||a.sourceBookingId.localeCompare(b.sourceBookingId)),[data]);
  const term=search.trim().toLocaleLowerCase('ru');
  const properties=(data?.properties||[]).filter(item=>!term||item.label.toLocaleLowerCase('ru').includes(term)||item.sourceLotId.includes(term));
  const inPeriod=bookings.filter(item=>intersects(item,start,end));
  const nextBooking=bookings.find(item=>item.arrivalDate>=end);

  useEffect(()=>{
    if(!data||explicitStart||inPeriod.length>0||bookings.length===0)return;
    const today=new Date().toISOString().slice(0,10);
    const nearest=bookings.find(item=>item.arrivalDate>=today)||bookings[0];
    onJump(nearest.arrivalDate);
  },[data,explicitStart,inPeriod.length,bookings,onJump]);

  return <>
    <div className="notice notice-warning source-preview-banner" role="status"><strong>Предпросмотр RealtyCalendar — не рабочие брони.</strong><p>{data?`${data.coverage.propertyCount} объектов и ${data.coverage.reservationCount} броней сохранены для сверки. `:'Загружаем сохранённые данные. '}Эта шахматка только показывает исходные даты; она не управляет занятостью и не меняет данные RealtyCalendar.</p></div>
    {resource.loading&&<Loading label="Загружаем исходную шахматку…"/>}
    {Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {data&&data.mode==='source_preview'&&<>
      <div className="source-preview-summary"><span>Объектов: <strong>{data.coverage.propertyCount}</strong></span><span>Броней в снимке: <strong>{data.coverage.reservationCount}</strong></span><span>В периоде: <strong>{inPeriod.length}</strong></span><span>Снимок: {new Date(data.asOf).toLocaleString('ru-RU')}</span>{nextBooking&&<Button onClick={()=>onJump(nextBooking.arrivalDate)}>К следующей брони ›</Button>}</div>
      <div className="calendar-scroll source-preview-scroll"><div className="calendar-grid" style={{minWidth:LABEL_WIDTH+DAY_COUNT*CELL_WIDTH}} role="grid" aria-label="Предпросмотр шахматки RealtyCalendar, только чтение">
        <div className="calendar-row calendar-head" role="row"><div className="calendar-label calendar-corner" role="columnheader"><strong>Объект RealtyCalendar</strong><small>{properties.length} из {data.coverage.propertyCount} · исходный снимок</small></div>{days.map(day=><div key={day} className={`calendar-head-cell ${[0,6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())?'weekend':''}`} role="columnheader"><small>{new Intl.DateTimeFormat('ru-RU',{weekday:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`))}</small><strong>{Number(day.slice(8))}</strong></div>)}</div>
        {properties.map(property=>{
          const current=bookings.filter(item=>item.sourceLotId===property.sourceLotId&&intersects(item,start,end));
          return <div className="calendar-row source-preview-row" role="row" key={property.sourceLotId}><div className="calendar-label" role="rowheader"><strong title={property.label}>{property.label}</strong><small>{property.city||'Город не указан'} · исходный объект</small></div>{days.map(day=><div key={day} className={`calendar-cell source-preview-cell ${[0,6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())?'weekend':''}`} role="gridcell" aria-label={`${property.label}, ${dateRu(day)}; данные о свободных датах не подтверждены`}/>)}
            {current.map(item=>{const first=Math.max(0,nights(start,item.arrivalDate));const last=Math.min(DAY_COUNT,nights(start,item.departureDate));return <span key={item.sourceBookingId} className="source-preview-bar" style={{left:LABEL_WIDTH+first*CELL_WIDTH+3,width:Math.max(12,(last-first)*CELL_WIDTH-6)}} title={`Бронь ${item.sourceBookingId} · ${item.status} · ${dateRu(item.arrivalDate)} — ${dateRu(item.departureDate)}`} aria-label={`Бронь ${item.sourceBookingId}, ${item.status}, ${dateRu(item.arrivalDate)} — ${dateRu(item.departureDate)}`}>№{item.sourceBookingId}</span>;})}
          </div>;
        })}
      </div></div>
      <div className="source-preview-mobile"><Panel title="Исходные объекты"><div className="record-list">{properties.map(property=>{const current=bookings.filter(item=>item.sourceLotId===property.sourceLotId&&intersects(item,start,end));return <div className="record-row" key={property.sourceLotId}><div className="record-main"><strong>{property.label}</strong><small>{property.city||'Город не указан'}</small>{current.map(item=><small key={item.sourceBookingId}>№{item.sourceBookingId} · {item.status} · {dateRu(item.arrivalDate)} — {dateRu(item.departureDate)}</small>)}{current.length===0&&<small>Нет записей в выбранном периоде; доступность не подтверждена</small>}</div></div>;})}</div></Panel></div>
      {properties.length===0&&<Empty title="Объекты не найдены" detail="Очистите поиск, чтобы увидеть исходную шахматку."/>}
      <p className="source-preview-footnote">Даты показаны как локальные даты источника. Часовые пояса объектов и смысл финансовых операций ещё сверяются. <Link to="/import-preview">Открыть полный список объектов и броней</Link>.</p>
    </>}
  </>;
}
