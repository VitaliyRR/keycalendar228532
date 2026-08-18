"use client";

import { useState, type CSSProperties } from "react";

const days = [
  ["Пн", "18"], ["Вт", "19"], ["Ср", "20"], ["Чт", "21"], ["Пт", "22"],
  ["Сб", "23"], ["Вс", "24"], ["Пн", "25"], ["Вт", "26"], ["Ср", "27"],
  ["Чт", "28"], ["Пт", "29"], ["Сб", "30"], ["Вс", "31"],
];

const properties = [
  {
    name: "Nevsky Residence",
    meta: "Санкт-Петербург · 4 единицы",
    units: [
      {
        name: "Апартаменты 01", detail: "2 гостя · 38 м²",
        bookings: [
          { start: 1, span: 4, name: "Анна Воронова", meta: "Оплачено", tone: "green", channel: "AV" },
          { start: 7, span: 5, name: "Илья Миронов", meta: "42 000 ₽", tone: "blue", channel: "СУ" },
        ],
      },
      {
        name: "Апартаменты 02", detail: "4 гостя · 54 м²",
        bookings: [
          { start: 2, span: 6, name: "Марк Левин", meta: "Долг 18 000 ₽", tone: "amber", channel: "BK" },
          { start: 10, span: 4, name: "Елена Сафина", meta: "Оплачено", tone: "green", channel: "ПР" },
        ],
      },
      {
        name: "Апартаменты 03", detail: "2 гостя · 32 м²",
        bookings: [{ start: 5, span: 5, name: "Ольга Белова", meta: "31 500 ₽", tone: "blue", channel: "AV" }],
      },
      {
        name: "Апартаменты 04", detail: "6 гостей · 78 м²",
        bookings: [
          { start: 1, span: 3, name: "Тех. блок", meta: "До 20 августа", tone: "gray", channel: "" },
          { start: 6, span: 7, name: "Семья Жуковых", meta: "112 000 ₽", tone: "plum", channel: "СУ" },
        ],
      },
    ],
  },
  {
    name: "Дом в Репино",
    meta: "Ленинградская область · 2 единицы",
    units: [
      {
        name: "Основной дом", detail: "8 гостей · 210 м²",
        bookings: [{ start: 3, span: 6, name: "Алексей Орлов", meta: "168 000 ₽", tone: "green", channel: "ПР" }],
      },
      {
        name: "Гостевой дом", detail: "4 гостя · 82 м²",
        bookings: [{ start: 8, span: 5, name: "Наталья Рудакова", meta: "Долг 24 000 ₽", tone: "amber", channel: "BK" }],
      },
    ],
  },
];

const stats = [
  { label: "Загрузка", value: "78%", delta: "+6,4%", note: "к прошлому месяцу" },
  { label: "Выручка", value: "1,84 млн ₽", delta: "+12,8%", note: "за август" },
  { label: "Средний чек", value: "46 200 ₽", delta: "+3,1%", note: "на бронирование" },
  { label: "К получению", value: "186 000 ₽", delta: "7 броней", note: "с остатком оплаты" },
];

const navigation = ["Обзор", "Шахматка", "Бронирования", "Гости", "Финансы", "Объекты", "Команда"];

type Booking = { start: number; span: number; name: string; meta: string; tone: string; channel: string };

function CalendarTrack({ bookings, onSelect }: { bookings: Booking[]; onSelect: (booking: Booking) => void }) {
  return (
    <div className="calendar-track">
      <div className="track-cells" aria-hidden="true">
        {days.map((day, index) => (
          <span className={(index > 4 && index < 7) || index > 11 ? "weekend" : ""} key={`${day[1]}-${index}`} />
        ))}
      </div>
      <div className="booking-layer">
        {bookings.map((booking) => (
          <button
            type="button"
            className={`booking booking-${booking.tone}`}
            key={`${booking.name}-${booking.start}`}
            style={{ "--booking-start": booking.start, "--booking-span": booking.span } as CSSProperties}
            onClick={() => onSelect(booking)}
          >
            {booking.channel && <span className="channel-mark">{booking.channel}</span>}
            <span className="booking-copy">
              <strong>{booking.name}</strong>
              <small>{booking.meta}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [creatingBooking, setCreatingBooking] = useState(false);

  const closePanel = () => {
    setSelectedBooking(null);
    setCreatingBooking(false);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark">K</span><span>KeyCalendar</span></div>

        <div className="workspace-switcher">
          <span className="workspace-avatar">NS</span>
          <span><small>Компания</small><strong>North Stay</strong></span>
          <button aria-label="Сменить компанию">⌄</button>
        </div>

        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map((item) => (
            <a className={item === "Шахматка" ? "active" : ""} href={item === "Шахматка" ? "/" : `/${item.toLocaleLowerCase("ru")}`} key={item}>
              <span className="nav-indicator" />{item}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <a href="/интеграции">Интеграции</a><a href="/настройки">Настройки</a>
          <div className="profile-card">
            <span className="profile-avatar">ВР</span>
            <span><strong>Виталий Романов</strong><small>Владелец</small></span>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Открыть меню" onClick={() => setMobileNavOpen((value) => !value)}>Меню</button>
          <div className="breadcrumbs">Операционный центр <span>/</span> Шахматка</div>
          <div className="topbar-actions">
            <button className="quiet-button">Поиск</button>
            <button className="quiet-button notice-button">Уведомления <span>3</span></button>
            <button className="primary-button" onClick={() => setCreatingBooking(true)}>Новое бронирование</button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Вторник, 18 августа</p>
              <h1>Шахматка</h1>
              <p>Занятость, оплаты и ближайшие события по всем объектам.</p>
            </div>
            <div className="health-pill"><span /> Все каналы синхронизированы</div>
          </section>

          <section className="stats-grid" aria-label="Ключевые показатели">
            {stats.map((stat) => (
              <article className="stat-card" key={stat.label}>
                <div className="stat-label">{stat.label}<button aria-label={`Подробнее: ${stat.label}`}>···</button></div>
                <strong>{stat.value}</strong>
                <div className="stat-footer"><span>{stat.delta}</span>{stat.note}</div>
              </article>
            ))}
          </section>

          <section className="operations-layout">
            <article className="calendar-card">
              <div className="calendar-toolbar">
                <div><h2>Август 2026</h2><span>6 единиц · 14 дней</span></div>
                <div className="calendar-controls">
                  <button className="date-button">‹</button><button className="today-button">Сегодня</button><button className="date-button">›</button>
                  <div className="filter-wrap">
                    <button className="filter-button" onClick={() => setFilterOpen((value) => !value)}>Все объекты <span>6</span></button>
                    {filterOpen && (
                      <div className="filter-popover">
                        <label><input type="checkbox" defaultChecked /> Nevsky Residence</label>
                        <label><input type="checkbox" defaultChecked /> Дом в Репино</label>
                        <button onClick={() => setFilterOpen(false)}>Применить</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="calendar-viewport">
                <div className="calendar-scroll">
                  <div className="calendar-head">
                    <div className="unit-heading">Объект и единица</div>
                    <div className="days-heading">
                      {days.map(([weekday, date], index) => (
                        <div className={date === "18" ? "today" : ((index > 4 && index < 7) || index > 11 ? "weekend" : "")} key={date}>
                          <span>{weekday}</span><strong>{date}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  {properties.map((property) => (
                    <div className="property-group" key={property.name}>
                      <div className="property-title"><span>{property.name}</span><small>{property.meta}</small></div>
                      {property.units.map((unit) => (
                        <div className="calendar-row" key={unit.name}>
                          <div className="unit-name"><strong>{unit.name}</strong><small>{unit.detail}</small></div>
                          <CalendarTrack bookings={unit.bookings} onSelect={setSelectedBooking} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="calendar-legend">
                <span><i className="legend-green" /> Оплачено</span><span><i className="legend-blue" /> Подтверждено</span>
                <span><i className="legend-amber" /> Есть долг</span><span><i className="legend-gray" /> Блокировка</span>
              </div>
            </article>

            <aside className="focus-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Сегодня</p><h2>В фокусе</h2></div><button aria-label="Настроить список">···</button>
              </div>
              <div className="focus-metrics">
                <div><span>Заезды</span><strong>4</strong></div><div><span>Выезды</span><strong>3</strong></div><div><span>Долги</span><strong>2</strong></div>
              </div>
              <div className="focus-list">
                <article><time>14:00</time><div><strong>Анна Воронова</strong><span>Апартаменты 01 · заезд</span></div><span className="status status-ready">Готово</span></article>
                <article><time>15:30</time><div><strong>Марк Левин</strong><span>Апартаменты 02 · заезд</span></div><span className="status status-attention">Доплата</span></article>
                <article><time>12:00</time><div><strong>Семья Соколовых</strong><span>Основной дом · выезд</span></div><span className="status status-neutral">Выезд</span></article>
              </div>
              <div className="finance-note">
                <div className="finance-note-head"><span>План на август</span><strong>82%</strong></div>
                <div className="progress"><span /></div><p>До плана выручки осталось 412 000 ₽</p>
                <a href="/финансы">Открыть финансовую аналитику</a>
              </div>
            </aside>
          </section>
        </div>
      </section>

      {(selectedBooking || creatingBooking) && <button className="drawer-backdrop" aria-label="Закрыть панель" onClick={closePanel} />}
      {(selectedBooking || creatingBooking) && (
        <aside className="booking-drawer" aria-label={creatingBooking ? "Новое бронирование" : "Детали бронирования"}>
          <div className="drawer-head">
            <div>
              <p className="eyebrow">{creatingBooking ? "Новая запись" : "Бронирование"}</p>
              <h2>{creatingBooking ? "Создать бронирование" : selectedBooking?.name}</h2>
            </div>
            <button aria-label="Закрыть" onClick={closePanel}>Закрыть</button>
          </div>

          {creatingBooking ? (
            <form className="booking-form" onSubmit={(event) => { event.preventDefault(); setCreatingBooking(false); }}>
              <label>Гость<input name="guest" placeholder="Имя и фамилия" required /></label>
              <label>Объект<select name="unit" defaultValue=""><option value="" disabled>Выберите единицу</option><option>Апартаменты 01</option><option>Апартаменты 02</option><option>Основной дом</option></select></label>
              <div className="form-row"><label>Заезд<input type="date" name="checkIn" required /></label><label>Выезд<input type="date" name="checkOut" required /></label></div>
              <div className="form-row"><label>Стоимость<input name="amount" placeholder="0 ₽" /></label><label>Источник<select name="source"><option>Прямое</option><option>Авито</option><option>Суточно.ру</option><option>Booking</option></select></label></div>
              <label>Комментарий<textarea name="comment" rows={4} placeholder="Пожелания гостя и детали заселения" /></label>
              <div className="drawer-actions"><button type="button" className="secondary-action" onClick={closePanel}>Отмена</button><button type="submit" className="save-action">Создать бронь</button></div>
            </form>
          ) : (
            <div className="booking-details">
              <div className="booking-summary"><span>Статус</span><strong>{selectedBooking?.meta}</strong></div>
              <dl><div><dt>Период</dt><dd>18–22 августа 2026</dd></div><div><dt>Объект</dt><dd>Nevsky Residence</dd></div><div><dt>Единица</dt><dd>Апартаменты 01</dd></div><div><dt>Источник</dt><dd>{selectedBooking?.channel || "Прямое бронирование"}</dd></div></dl>
              <div className="payment-block"><div><span>Стоимость проживания</span><strong>54 000 ₽</strong></div><div><span>Оплачено</span><strong>36 000 ₽</strong></div><div className="payment-due"><span>Остаток</span><strong>18 000 ₽</strong></div></div>
              <div className="drawer-actions"><button className="secondary-action" onClick={closePanel}>Закрыть</button><button className="save-action">Редактировать</button></div>
            </div>
          )}
        </aside>
      )}

      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}
    </main>
  );
}
