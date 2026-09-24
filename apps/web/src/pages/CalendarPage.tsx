import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { orgPath, query } from '../api';
import { Badge, Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useResource } from '../components';
import { addDays, dateRu, firstStay, guestName, money, reservationStatus } from '../format';
import { screenPath } from '../screens';
import type { CalendarPayload, Reservation, Unit } from '../types';

const ROW_HEIGHT = 56;
const CELL_WIDTH = 79;
const LABEL_WIDTH = 244;
const DAY_COUNT = 14;
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
};

export function CalendarPage({ orgId, filtersOnly = false, canPreview = false }: { orgId: string; filtersOnly?: boolean; canPreview?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const start = params.get('from') || today();
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [selected, setSelected] = useState<{unitId:string;from:string;to?:string} | null>(null);
  const [drawer, setDrawer] = useState<Reservation | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({length:DAY_COUNT}, (_,i)=>addDays(start,i)), [start]);
  const end = addDays(start, DAY_COUNT);
  const path = orgPath(orgId, `calendar${query({from:start,to:end})}`);
  const resource = useResource<CalendarPayload>(path);
  const payload = resource.data;
  const units = useMemo(() => (payload?.units || []).filter(unit => {
    const matchesText=unit.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) || (unit.property_name || '').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'));
    const matchesStatus=status==='all'||(payload?.reservations||[]).some(res=>firstStay(res)?.unit_id===unit.id&&res.status===status);
    return matchesText&&matchesStatus;
  }), [payload,search,status]);
  const bookingByUnit = useMemo(() => {
    const map = new Map<string,Reservation[]>();
    for (const booking of payload?.reservations || []) {
      const stay = firstStay(booking);
      if (!stay) continue;
      const list = map.get(stay.unit_id) || [];
      list.push(booking); map.set(stay.unit_id,list);
    }
    return map;
  }, [payload]);
  const blockByUnit = useMemo(() => {
    const map = new Map<string,CalendarPayload['blocks']>();
    for (const block of payload?.blocks || []) {
      const list = map.get(block.unit_id) || []; list.push(block);map.set(block.unit_id,list);
    }
    return map;
  }, [payload]);

  function updateParams(next: Record<string,string|null>) {
    const current = new URLSearchParams(params);
    Object.entries(next).forEach(([key,value]) => value ? current.set(key,value) : current.delete(key));
    setParams(current);
    gridRef.current?.scrollTo({top:0});
  }
  function openCreate(unitId?: string, checkin?: string, checkout?: string) {
    const qp = new URLSearchParams();
    if (unitId) qp.set('unit',unitId);
    if (checkin) qp.set('checkin',checkin);
    if (checkout) qp.set('checkout',checkout);
    navigate(`${screenPath(orgId,'SCR-RES-02')}${qp.size ? `?${qp.toString()}` : ''}`);
  }
  function chooseCell(unit: Unit, day: string, event: React.MouseEvent | KeyboardEvent) {
    const withShift = event.shiftKey;
    if (selected?.unitId===unit.id && (withShift || selected.from!==day)) {
      const from = selected.from <= day ? selected.from : day;
      const to = addDays(selected.from <= day ? day : selected.from,1);
      setSelected({unitId:unit.id,from,to});
      return;
    }
    if (selected?.unitId===unit.id && selected.from===day) {
      openCreate(unit.id,day,addDays(day,1)); return;
    }
    setSelected({unitId:unit.id,from:day,to:addDays(day,1)});
  }
  function onCellKey(event: KeyboardEvent<HTMLButtonElement>, unitIndex: number, dayIndex: number, unit:Unit, day:string) {
    if (event.key==='Escape') { setSelected(null); return; }
    if (event.key==='Enter' || event.key===' ') { event.preventDefault(); chooseCell(unit,day,event); return; }
    const delta = event.key==='ArrowRight' ? 1 : event.key==='ArrowLeft' ? -1 : event.key==='ArrowDown' ? DAY_COUNT : event.key==='ArrowUp' ? -DAY_COUNT : 0;
    if (delta) {
      event.preventDefault();
      if (event.shiftKey) setSelected({unitId:unit.id,from:selected?.unitId===unit.id ? selected.from : day,to:addDays(day,1)});
      const absolute = Math.max(0,Math.min(units.length*DAY_COUNT-1,unitIndex*DAY_COUNT+dayIndex+delta));
      const nextUnit = units[Math.floor(absolute/DAY_COUNT)]; const nextDay=absolute%DAY_COUNT;
      const targetId=`day-${nextUnit.id}-${nextDay}`;
      if(Math.floor(absolute/DAY_COUNT)<visibleStart||Math.floor(absolute/DAY_COUNT)>=visibleEnd){
        gridRef.current?.scrollTo({top:Math.max(0,Math.floor(absolute/DAY_COUNT)*ROW_HEIGHT+60)});
        requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById(targetId)?.focus()));
      }else document.getElementById(targetId)?.focus();
    }
  }
  function closeDrawer() { setDrawer(null); lastFocus.current?.focus(); }
  const visibleStart = Math.max(0, Math.floor(Math.max(0,scrollTop-60)/ROW_HEIGHT)-3);
  const visibleEnd = Math.min(units.length, visibleStart+19);
  const visibleUnits = units.slice(visibleStart,visibleEnd);

  return <div className="calendar-page">
    <PageHeader title={filtersOnly?'Вид календаря и фильтры':'Шахматка'} description="Занятость по локальным датам объектов. Заявка не удерживает даты." actions={<>{canPreview&&<Link className="button button-secondary" to="/import-preview">Предпросмотр импорта</Link>}<Button variant="primary" onClick={()=>openCreate()}>+ Бронирование</Button></>} />
    <div className="toolbar calendar-toolbar"><div className="toolbar-group"><Button onClick={()=>updateParams({from:today()})}>Сегодня</Button><Button aria-label="Предыдущие две недели" onClick={()=>updateParams({from:addDays(start,-DAY_COUNT)})}>‹</Button><Button aria-label="Следующие две недели" onClick={()=>updateParams({from:addDays(start,DAY_COUNT)})}>›</Button><strong>{dateRu(start)} — {dateRu(addDays(end,-1))}</strong></div><div className="toolbar-group"><Field label="Начало периода"><input type="date" value={start} onChange={event=>updateParams({from:event.target.value})}/></Field><Button onClick={()=>updateParams({search:null,status:null})}>Сбросить фильтры</Button></div></div>
    <div className="calendar-filters"><Field label="Поиск объекта"><input type="search" value={search} onChange={event=>{setSearch(event.target.value); updateParams({search:event.target.value || null});}} placeholder="Название или адрес"/></Field><Field label="Статус"><select value={status} onChange={event=>{setStatus(event.target.value);updateParams({status:event.target.value==='all'?null:event.target.value});}}><option value="all">Все записи</option><option value="confirmed">Подтверждённые</option><option value="request">Заявки</option><option value="cancelled">Отменённые</option></select></Field><span className="calendar-freshness">{payload?.as_of ? `Обновлено ${new Date(payload.as_of).toLocaleString('ru-RU')}` : 'Данные загружаются по запросу'}</span></div>
    {resource.loading && <Loading/>}
    {Boolean(resource.error) && <ErrorBox error={resource.error} retry={resource.reload}/>}
    {!resource.loading && !resource.error && payload && units.length===0 && <Empty title={payload.units.length ? 'По фильтрам ничего не найдено' : 'Пока нет объектов'} detail={payload.units.length ? 'Измените поиск или сбросьте фильтры.' : 'Исходные записи для переноса доступны в отдельном предпросмотре. Рабочий календарь заполнится после сверки и переноса.'} action={canPreview&&!payload.units.length?<Link className="button button-primary" to="/import-preview">Показать исходные брони</Link>:<Button onClick={()=>navigate(screenPath(orgId,'SCR-OBJ-01'))}>Открыть объекты</Button>}/>}
    {!resource.loading && !resource.error && units.length>0 && <>
      <div className="calendar-scroll" ref={gridRef} onScroll={event=>setScrollTop(event.currentTarget.scrollTop)}>
        <div className="calendar-grid" style={{minWidth:LABEL_WIDTH+DAY_COUNT*CELL_WIDTH}} role="grid" aria-label="Календарь занятости">
          <div className="calendar-row calendar-head" role="row"><div className="calendar-label calendar-corner" role="columnheader"><strong>Объект / номер</strong><small>{units.length} объектов · все каналы</small></div>{days.map(day=><div key={day} className={`calendar-head-cell ${[0,6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())?'weekend':''}`} role="columnheader"><small>{new Intl.DateTimeFormat('ru-RU',{weekday:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`))}</small><strong>{Number(day.slice(8))}</strong></div>)}</div>
          <div style={{height:visibleStart*ROW_HEIGHT}} aria-hidden="true"/>
          {visibleUnits.map((unit,index)=>{const rowIndex=visibleStart+index; return <div className="calendar-row" role="row" key={unit.id}><div className="calendar-label" role="rowheader"><strong>{unit.property_name ? `${unit.property_name} · ` : ''}{unit.name}</strong><small>{unit.capacity ? `${unit.capacity} гостя` : 'Номер'} · <span>локальное время</span></small></div>{days.map((day,dayIndex)=>{
            const dayRecords=(bookingByUnit.get(unit.id)||[]).filter(res=>{const stay=firstStay(res); return stay && stay.checkin<=day && day<stay.checkout;});
            const record=dayRecords.find(res=>!['request','draft','cancelled'].includes(res.status))||dayRecords[0];
            const block=(blockByUnit.get(unit.id)||[]).find(item=>{const from=item.from||item.checkin;const to=item.to||item.checkout;return from&&to&&from<=day&&day<to;});
            const active=selected?.unitId===unit.id&&selected.from<=day&&day<(selected.to||addDays(selected.from,1));
            const isRequest=record?.status==='request'||record?.status==='draft';
            const occupied=record&&!isRequest&&record.status!=='cancelled';
            return <div className={`calendar-cell ${active?'selected':''} ${[0,6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())?'weekend':''}`} role="gridcell" key={day}>
              {record && <button type="button" className={`calendar-record ${isRequest?'request':occupied?'occupied':'cancelled'}`} onClick={event=>{lastFocus.current=event.currentTarget;setDrawer(record);}} aria-label={`${unit.name}, ${dateRu(day)}, ${reservationStatus[record.status]||record.status}, ${guestName(record)}, ${dateRu(firstStay(record)?.checkin)} — ${dateRu(firstStay(record)?.checkout)}`} title={`${reservationStatus[record.status]||record.status}: ${guestName(record)}; ${dateRu(firstStay(record)?.checkin)} — ${dateRu(firstStay(record)?.checkout)}`}><span>{day===firstStay(record)?.checkin||dayIndex===0 ? `${isRequest?'Заявка: ':''}${guestName(record)}` : '·'}</span></button>}
              {block && !record && <span className="calendar-block" title={block.reason || 'Даты закрыты'}>Закрыто</span>}
              {!occupied && !block && <button id={`day-${unit.id}-${dayIndex}`} type="button" className="calendar-free" tabIndex={rowIndex===0&&dayIndex===0?0:-1} onClick={event=>chooseCell(unit,day,event)} onKeyDown={event=>onCellKey(event,rowIndex,dayIndex,unit,day)} aria-label={`${unit.name}, ${dateRu(day)}, ${record?'есть заявка, дата свободна':'свободно'}, ${unit.base_rate_minor?`базовая цена от ${money(unit.base_rate_minor,unit.currency)}`:'цена после расчёта'}`}>{record ? '' : unit.base_rate_minor ? `от ${money(unit.base_rate_minor,unit.currency)}` : 'Свободно'}</button>}
            </div>;
          })}</div>})}
          <div style={{height:(units.length-visibleEnd)*ROW_HEIGHT}} aria-hidden="true"/>
        </div>
      </div>
      <div className="calendar-mobile-list"><Panel title="Объекты"><div className="record-list">{units.map(unit=>{
        const stays=(bookingByUnit.get(unit.id)||[]).filter(res=>{const stay=firstStay(res);return stay&&stay.checkin<end&&stay.checkout>start;});
        const blocks=(blockByUnit.get(unit.id)||[]).filter(block=>{const from=block.from||block.checkin;const to=block.to||block.checkout;return Boolean(from&&to&&from<end&&to>start);});
        return <div className="mobile-unit" key={unit.id}><div><strong>{unit.property_name ? `${unit.property_name} · ` : ''}{unit.name}</strong><small>{unit.capacity ? `${unit.capacity} гостя` : 'Номер'} · от {money(unit.base_rate_minor,unit.currency)}</small>
          <ul className="mobile-stays">{stays.map(res=><li key={res.id}><button type="button" onClick={event=>{lastFocus.current=event.currentTarget;setDrawer(res);}}><Badge state={res.status}>{reservationStatus[res.status]||res.status}</Badge> {guestName(res)} · {dateRu(firstStay(res)?.checkin)} — {dateRu(firstStay(res)?.checkout)}</button></li>)}{blocks.map((block,index)=><li key={block.id||index}><Badge state="conflict">Закрыто</Badge> {dateRu(block.from||block.checkin)} — {dateRu(block.to||block.checkout)}</li>)}{stays.length===0&&blocks.length===0&&<li className="muted">На выбранный период записей нет.</li>}</ul>
        </div><Button onClick={()=>openCreate(unit.id)}>Выбрать даты</Button></div>;
      })}</div></Panel></div>
      <p className="calendar-legend"><Badge state="confirmed">Подтверждена</Badge><Badge state="request">Заявка · даты свободны</Badge><Badge state="conflict">Конфликт</Badge><span>Закрыто / ремонт</span><span>«от» — базовая цена; точную сумму покажет расчёт.</span></p>
      <div className="sr-only" aria-live="polite">{selected ? `Выбраны даты ${dateRu(selected.from)} — ${dateRu(selected.to)}. Нажмите «Создать бронь» для продолжения.` : ''}</div>
      {selected && <div className="selection-bar"><span>{dateRu(selected.from)} — {dateRu(selected.to)} · {units.find(unit=>unit.id===selected.unitId)?.name}</span><Button onClick={()=>setSelected(null)}>Снять выбор</Button><Button variant="primary" onClick={()=>openCreate(selected.unitId,selected.from,selected.to)}>Создать бронь</Button></div>}
    </>}
    {drawer && <div className="drawer-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeDrawer();}}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Бронь ${drawer.reference||drawer.id}`}><button className="drawer-close" onClick={closeDrawer} aria-label="Закрыть">×</button><h2>{drawer.reference||'Бронирование'}</h2><Badge state={drawer.status}>{reservationStatus[drawer.status]||drawer.status}</Badge><dl className="detail-list"><dt>Гость</dt><dd>{guestName(drawer)}</dd><dt>Даты</dt><dd>{dateRu(firstStay(drawer)?.checkin)} — {dateRu(firstStay(drawer)?.checkout)}</dd><dt>Доставка</dt><dd>{drawer.sync_state||'—'}</dd></dl><Button variant="primary" onClick={()=>navigate(screenPath(orgId,'SCR-RES-03',drawer.id))}>Полная карточка</Button></aside></div>}
  </div>;
}
