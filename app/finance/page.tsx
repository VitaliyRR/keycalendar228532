"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const navigation = [
  ["Обзор", "/overview"], ["Шахматка", "/"], ["Бронирования", "/bookings"],
  ["Гости", "/guests"], ["Финансы", "/finance"], ["Объекты", "/properties"], ["Команда", "/team"],
];

const propertyRows = [
  { property: "Nevsky Residence", revenue: 1184000, expenses: 392000, profit: 792000, occupancy: 84, adr: 7840, revpar: 6586 },
  { property: "Дом в Репино", revenue: 656000, expenses: 273000, profit: 383000, occupancy: 67, adr: 14890, revpar: 9976 },
];

const expenseRows = [
  { label: "Выплаты собственникам", amount: 318000, share: 48, tone: "owner" },
  { label: "Комиссии каналов", amount: 121000, share: 18, tone: "channel" },
  { label: "Уборка и расходники", amount: 97000, share: 15, tone: "cleaning" },
  { label: "Налоги", amount: 72000, share: 11, tone: "tax" },
  { label: "Ремонт и прочее", amount: 57000, share: 8, tone: "other" },
];

const formatMoney = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

export default function FinancePage() {
  const [accountingMode, setAccountingMode] = useState<"accrual" | "cash">("accrual");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const visibleRows = useMemo(
    () => propertyRows.filter((row) => propertyFilter === "all" || row.property === propertyFilter),
    [propertyFilter],
  );

  const totals = useMemo(() => visibleRows.reduce(
    (result, row) => ({
      revenue: result.revenue + row.revenue,
      expenses: result.expenses + row.expenses,
      profit: result.profit + row.profit,
    }),
    { revenue: 0, expenses: 0, profit: 0 },
  ), [visibleRows]);

  return (
    <main className="app-shell finance-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" href="/"><span className="brand-mark">K</span><span>KeyCalendar</span></Link>
        <div className="workspace-switcher">
          <span className="workspace-avatar">NS</span>
          <span><small>Компания</small><strong>North Stay</strong></span>
          <button aria-label="Сменить компанию">⌄</button>
        </div>
        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map(([label, href]) => (
            <a className={label === "Финансы" ? "active" : ""} href={href} key={label}>
              <span className="nav-indicator" />{label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="/booking">Прямое бронирование</a><a href="/integrations">Интеграции</a><a href="/settings">Настройки</a>
          <div className="profile-card"><span className="profile-avatar">ВР</span><span><strong>Виталий Романов</strong><small>Владелец</small></span></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Открыть меню" onClick={() => setMobileNavOpen((value) => !value)}>Меню</button>
          <div className="breadcrumbs">Управленческий учёт <span>/</span> Финансы</div>
          <div className="topbar-actions"><a className="quiet-button link-button" href="/booking">Страница бронирования</a><button className="primary-button">Экспорт отчёта</button></div>
        </header>

        <div className="content finance-content">
          <section className="page-heading finance-heading">
            <div><p className="eyebrow">Август 2026</p><h1>Финансовая аналитика</h1><p>Доходность, денежный поток и расчёты с собственниками в одном отчёте.</p></div>
            <div className="finance-mode" aria-label="Метод учёта">
              <button className={accountingMode === "accrual" ? "active" : ""} onClick={() => setAccountingMode("accrual")}>Начисление</button>
              <button className={accountingMode === "cash" ? "active" : ""} onClick={() => setAccountingMode("cash")}>По оплатам</button>
            </div>
          </section>

          <section className="report-filters" aria-label="Фильтры отчёта">
            <label><span>Период</span><select defaultValue="august"><option value="august">1–31 августа 2026</option><option value="july">1–31 июля 2026</option><option value="quarter">III квартал 2026</option></select></label>
            <label><span>Объект</span><select value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}><option value="all">Все объекты</option>{propertyRows.map((row) => <option key={row.property}>{row.property}</option>)}</select></label>
            <label><span>Источник</span><select defaultValue="all"><option value="all">Все каналы</option><option>Прямые</option><option>Авито</option><option>Суточно.ру</option><option>Booking</option></select></label>
            <label><span>Сравнение</span><select defaultValue="previous"><option value="previous">Предыдущий период</option><option value="year">Год к году</option><option value="plan">С планом</option></select></label>
            <button className="saved-filter">Сохранить набор</button>
          </section>

          <section className="finance-kpis" aria-label="Ключевые финансовые показатели">
            <article><span>Выручка</span><strong>{formatMoney(totals.revenue)}</strong><small className="positive">+12,8% к июлю</small></article>
            <article><span>Чистая прибыль</span><strong>{formatMoney(totals.profit)}</strong><small className="positive">Маржа 63,9%</small></article>
            <article><span>Расходы</span><strong>{formatMoney(totals.expenses)}</strong><small>36,1% от выручки</small></article>
            <article><span>RevPAR</span><strong>7 274 ₽</strong><small className="positive">+8,3% к июлю</small></article>
            <article><span>Загрузка</span><strong>78%</strong><small>142 из 182 ночей</small></article>
          </section>

          <section className="finance-grid">
            <article className="report-card profit-card">
              <div className="report-card-head"><div><p className="eyebrow">Результат месяца</p><h2>Доходы и расходы</h2></div><span>{accountingMode === "accrual" ? "По датам проживания" : "По датам платежей"}</span></div>
              <div className="profit-summary"><div><span>Выручка</span><strong>1,84 млн ₽</strong></div><i /><div><span>Расходы</span><strong>665 тыс. ₽</strong></div><b /><div className="profit-result"><span>Прибыль</span><strong>1,18 млн ₽</strong></div></div>
              <div className="month-bars" aria-label="Динамика доходов и расходов">
                {[64, 75, 68, 86, 72, 91, 79, 96].map((value, index) => <div className="month-column" key={index}><span style={{ height: `${value}%` }} /><i style={{ height: `${Math.round(value * .36)}%` }} /></div>)}
              </div>
              <div className="chart-caption"><span><i className="revenue-key" />Выручка</span><span><i className="expense-key" />Расходы</span><small>1–31 августа</small></div>
            </article>

            <article className="report-card expenses-card">
              <div className="report-card-head"><div><p className="eyebrow">665 000 ₽</p><h2>Структура расходов</h2></div><button>Настроить</button></div>
              <div className="expense-list">
                {expenseRows.map((row) => <div className="expense-row" key={row.label}><div><span>{row.label}</span><strong>{formatMoney(row.amount)}</strong></div><div className="expense-track"><span className={`expense-${row.tone}`} style={{ width: `${row.share}%` }} /></div><small>{row.share}%</small></div>)}
              </div>
            </article>
          </section>

          <section className="report-card property-profitability">
            <div className="report-card-head"><div><p className="eyebrow">По объектам</p><h2>Доходность портфеля</h2></div><button>Настроить столбцы</button></div>
            <div className="profit-table-wrap"><table className="profit-table"><thead><tr><th>Объект</th><th>Выручка</th><th>Расходы</th><th>Прибыль</th><th>Маржа</th><th>Загрузка</th><th>ADR</th><th>RevPAR</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.property}><td><strong>{row.property}</strong><span>{row.property === "Nevsky Residence" ? "4 единицы" : "2 единицы"}</span></td><td>{formatMoney(row.revenue)}</td><td>{formatMoney(row.expenses)}</td><td className="profit-cell">{formatMoney(row.profit)}</td><td>{Math.round(row.profit / row.revenue * 100)}%</td><td>{row.occupancy}%</td><td>{formatMoney(row.adr)}</td><td>{formatMoney(row.revpar)}</td></tr>)}</tbody></table></div>
          </section>

          <section className="finance-bottom-grid">
            <article className="report-card owner-settlements">
              <div className="report-card-head"><div><p className="eyebrow">Индивидуальные условия</p><h2>Расчёты с собственниками</h2></div><a href="/owners">Все договоры</a></div>
              <div className="settlement-row"><span className="owner-avatar">АП</span><div><strong>Александр Петров</strong><small>Nevsky Residence · 25% от чистой выручки</small></div><span><small>К выплате</small><strong>214 500 ₽</strong></span><b className="settlement-ready">Рассчитано</b></div>
              <div className="settlement-row"><span className="owner-avatar">МС</span><div><strong>Марина Соколова</strong><small>Дом в Репино · фиксированная сумма + 10%</small></div><span><small>К выплате</small><strong>103 500 ₽</strong></span><b className="settlement-check">На проверке</b></div>
            </article>
            <article className="report-card finance-insight"><p className="eyebrow">Автоматический вывод</p><h2>Прямые бронирования выгоднее</h2><p>Доля прямых броней выросла до 31%. Экономия на комиссиях за август составила 46 800 ₽.</p><div><span>Потенциал при доле 40%</span><strong>+28 000 ₽ в месяц</strong></div><a href="/booking">Открыть модуль прямых продаж</a></article>
          </section>
        </div>
      </section>
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}
    </main>
  );
}
