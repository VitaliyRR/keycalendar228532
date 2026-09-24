import { useMemo, useState } from 'react';
import { orgPath } from '../api';
import { Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useResource } from '../components';
import { dateRu } from '../format';

interface SourceProperty {
  sourceLotId: string;
  label: string;
  city: string | null;
  timezone: null;
}

interface SourceReservation {
  sourceBookingId: string;
  sourceLotId: string;
  sourceLotLabel: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  amountText: string | null;
  currency: null;
}

interface ImportPreview {
  mode: 'source_preview';
  asOf: string;
  properties: SourceProperty[];
  reservations: SourceReservation[];
  coverage: {propertyCount: number; reservationCount: number};
  notice: string;
}

export function ImportPreviewPage({orgId}:{orgId:string}) {
  const resource=useResource<ImportPreview>(orgPath(orgId,'import-preview'));
  const [view,setView]=useState<'reservations'|'properties'>('reservations');
  const [search,setSearch]=useState('');
  const [lotId,setLotId]=useState('');
  const data=resource.data;
  const properties=useMemo(()=>[...(data?.properties||[])].sort((a,b)=>a.label.localeCompare(b.label,'ru')),[data]);
  const reservations=useMemo(()=>[...(data?.reservations||[])].sort((a,b)=>a.arrivalDate.localeCompare(b.arrivalDate)||a.sourceBookingId.localeCompare(b.sourceBookingId)),[data]);
  const term=search.trim().toLocaleLowerCase('ru');
  const visibleReservations=reservations.filter(item=>(!lotId||item.sourceLotId===lotId)&&(!term||[item.sourceBookingId,item.sourceLotLabel,item.status].some(value=>value.toLocaleLowerCase('ru').includes(term))));
  const visibleProperties=properties.filter(item=>!term||[item.sourceLotId,item.label,item.city||''].some(value=>value.toLocaleLowerCase('ru').includes(term)));

  return <>
    <PageHeader eyebrow="Перенос · доступ владельца и администратора" title="Предпросмотр импорта" description="Исходные объекты и брони RealtyCalendar, сохранённые для сверки перед переносом." actions={<Button onClick={resource.reload} disabled={resource.loading}>Обновить</Button>}/>
    <div className="notice notice-warning" role="status"><strong>Это предпросмотр исходных данных.</strong> Эти записи ещё не созданы в рабочих объектах и календаре Кей Календаря. Изменения здесь не выполняются.</div>
    {resource.loading&&<Loading label="Загружаем сохранённые исходные данные…"/>}
    {Boolean(resource.error)&&<ErrorBox error={resource.error} retry={resource.reload}/>}
    {data&&data.mode==='source_preview'&&<>
      <div className="import-preview-metrics" aria-label="Покрытие предпросмотра">
        <div className="import-preview-metric"><strong>{data.coverage.propertyCount}</strong><span>текущих объектов</span></div>
        <div className="import-preview-metric"><strong>{data.coverage.reservationCount}</strong><span>броней в снимке</span></div>
        <div className="import-preview-metric import-preview-metric-note"><strong>Только чтение</strong><span>состояние на {new Date(data.asOf).toLocaleString('ru-RU')}</span></div>
      </div>
      <p className="import-preview-caption">Даты заезда и выезда показаны как локальные календарные даты источника. Часовые пояса объектов ещё сверяются.</p>
      <div className="import-preview-tabs" role="tablist" aria-label="Состав предпросмотра">
        <button type="button" role="tab" aria-selected={view==='reservations'} className={view==='reservations'?'current':''} onClick={()=>{setView('reservations');setSearch('');}}>Брони <span>{reservations.length}</span></button>
        <button type="button" role="tab" aria-selected={view==='properties'} className={view==='properties'?'current':''} onClick={()=>{setView('properties');setSearch('');}}>Объекты <span>{properties.length}</span></button>
      </div>
      <div className="toolbar import-preview-toolbar">
        <Field label="Поиск"><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={view==='reservations'?'ID брони, объект или статус':'ID, название или город'}/></Field>
        {view==='reservations'&&<Field label="Объект"><select value={lotId} onChange={event=>setLotId(event.target.value)}><option value="">Все объекты</option>{properties.map(item=><option key={item.sourceLotId} value={item.sourceLotId}>{item.label}</option>)}</select></Field>}
        <span className="import-preview-count" aria-live="polite">Показано: {view==='reservations'?visibleReservations.length:visibleProperties.length}</span>
      </div>
      {view==='reservations'?<Panel title="Брони RealtyCalendar">
        {visibleReservations.length?<div className="table-scroll"><table className="import-preview-table"><thead><tr><th scope="col">ID в источнике</th><th scope="col">Объект</th><th scope="col">Заезд</th><th scope="col">Выезд</th><th scope="col">Статус в источнике</th></tr></thead><tbody>{visibleReservations.map(item=><tr key={item.sourceBookingId}><td><strong>{item.sourceBookingId}</strong></td><td>{item.sourceLotLabel}</td><td>{dateRu(item.arrivalDate)}</td><td>{dateRu(item.departureDate)}</td><td><span className="chip">{item.status}</span></td></tr>)}</tbody></table></div>:<Empty title="По фильтрам ничего не найдено" detail="Измените поиск или выберите другой объект."/>}
      </Panel>:<Panel title="Объекты RealtyCalendar">
        {visibleProperties.length?<div className="table-scroll"><table className="import-preview-table"><thead><tr><th scope="col">Объект</th><th scope="col">ID в источнике</th><th scope="col">Город</th><th scope="col">Часовой пояс</th></tr></thead><tbody>{visibleProperties.map(item=><tr key={item.sourceLotId}><td><strong>{item.label}</strong></td><td>{item.sourceLotId}</td><td>{item.city||'—'}</td><td>На сверке</td></tr>)}</tbody></table></div>:<Empty title="По фильтрам ничего не найдено" detail="Измените поисковый запрос."/>}
      </Panel>}
      <p className="muted">{data.notice}</p>
    </>}
  </>;
}
