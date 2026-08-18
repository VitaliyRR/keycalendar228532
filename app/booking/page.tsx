"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Stay = {
  id: string;
  name: string;
  location: string;
  category: string;
  guests: number;
  bedrooms: number;
  area: number;
  price: number;
  remaining: number;
  accent: string;
  features: string[];
};

const stays: Stay[] = [
  { id: "nevsky-01", name: "Nevsky Residence 01", location: "Санкт-Петербург · Невский проспект", category: "Апартаменты", guests: 2, bedrooms: 1, area: 38, price: 7800, remaining: 2, accent: "sage", features: ["Самостоятельное заселение", "Рабочее место", "Кондиционер"] },
  { id: "nevsky-02", name: "Nevsky Residence 02", location: "Санкт-Петербург · Невский проспект", category: "Апартаменты", guests: 4, bedrooms: 2, area: 54, price: 10900, remaining: 1, accent: "clay", features: ["Вид на город", "Две спальни", "Стиральная машина"] },
  { id: "repino-main", name: "Дом в Репино", location: "Ленинградская область · Репино", category: "Дом", guests: 8, bedrooms: 4, area: 210, price: 28000, remaining: 1, accent: "pine", features: ["Сауна", "Камин", "Закрытая территория"] },
];

const formatMoney = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

export default function BookingPage() {
  const [guestCount, setGuestCount] = useState(2);
  const [selectedStay, setSelectedStay] = useState<Stay | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState("СБП");

  const visibleStays = useMemo(() => stays.filter((stay) => stay.guests >= guestCount), [guestCount]);
  const nights = 4;

  return (
    <main className="booking-site">
      <header className="booking-site-header">
        <a className="booking-brand" href="/booking"><span>K</span><div><strong>North Stay</strong><small>управление гостеприимством</small></div></a>
        <nav aria-label="Навигация страницы бронирования"><a href="#stays">Объекты</a><a href="#terms">Условия</a><a href="#contacts">Контакты</a></nav>
        <a className="booking-phone" href="tel:+78005550182">8 800 555-01-82</a>
      </header>

      <section className="booking-hero">
        <div className="booking-hero-copy"><p className="booking-kicker">Санкт-Петербург и Ленинградская область</p><h1>Пространства, куда хочется возвращаться</h1><p>Выберите свободные даты, забронируйте напрямую и получите лучшие условия без комиссии площадок.</p><div className="trust-line"><span>Мгновенное подтверждение</span><span>Безопасная оплата</span><span>Поддержка 24/7</span></div></div>
        <div className="booking-hero-art" aria-label="Интерьер апартаментов"><div className="art-window" /><div className="art-sofa" /><div className="art-table" /><span>North Stay Collection</span></div>
      </section>

      <section className="availability-search" aria-label="Поиск доступных объектов">
        <label><span>Заезд</span><input type="date" defaultValue="2026-08-24" /></label>
        <label><span>Выезд</span><input type="date" defaultValue="2026-08-28" /></label>
        <label><span>Гости</span><select value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))}>{[1, 2, 3, 4, 6, 8].map((count) => <option value={count} key={count}>{count} {count === 1 ? "гость" : count < 5 ? "гостя" : "гостей"}</option>)}</select></label>
        <button onClick={() => document.querySelector("#stays")?.scrollIntoView({ behavior: "smooth" })}>Найти варианты</button>
      </section>

      <section className="stays-section" id="stays">
        <div className="stays-heading"><div><p className="booking-kicker">Доступно на выбранные даты</p><h2>{visibleStays.length} варианта размещения</h2></div><div className="booking-benefit"><strong>−7%</strong><span>при прямом бронировании</span></div></div>
        <div className="stay-grid">
          {visibleStays.map((stay, index) => (
            <article className="stay-card" key={stay.id}>
              <div className={`stay-visual stay-${stay.accent}`}><span>{index + 1 < 10 ? `0${index + 1}` : index + 1}</span><small>{stay.category}</small><div className="visual-room"><i /><b /><em /></div></div>
              <div className="stay-card-body"><div className="stay-card-top"><div><span>{stay.location}</span><h3>{stay.name}</h3></div>{stay.remaining === 1 && <b>Последний вариант</b>}</div>
                <div className="stay-specs"><span>до {stay.guests} гостей</span><span>{stay.bedrooms} {stay.bedrooms === 1 ? "спальня" : "спальни"}</span><span>{stay.area} м²</span></div>
                <ul>{stay.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                <div className="stay-price"><div><span>за 1 ночь</span><strong>{formatMoney(stay.price)}</strong><small>{formatMoney(stay.price * nights)} за {nights} ночи</small></div><button onClick={() => { setSelectedStay(stay); setRequestSent(false); }}>Выбрать</button></div>
              </div>
            </article>
          ))}
        </div>
        {visibleStays.length === 0 && <div className="no-stays"><h3>Нет вариантов для {guestCount} гостей</h3><p>Измените количество гостей или свяжитесь с нами — предложим размещение в нескольких соседних объектах.</p></div>}
      </section>

      <section className="booking-terms" id="terms"><div><p className="booking-kicker">Прозрачные условия</p><h2>Всё важное — до оплаты</h2></div><div className="terms-grid"><article><span>01</span><h3>Гибкая отмена</h3><p>Бесплатная отмена за 7 дней. Позже удерживается стоимость первых суток.</p></article><article><span>02</span><h3>Безопасная оплата</h3><p>ЮKassa, Т-Банк, СБП и CloudPayments. Банковские данные не хранятся у нас.</p></article><article><span>03</span><h3>Поддержка гостя</h3><p>Инструкция по заселению и личный контакт менеджера придут после оплаты.</p></article></div></section>

      <footer className="booking-footer" id="contacts"><a className="booking-brand" href="/booking"><span>K</span><div><strong>North Stay</strong><small>прямое бронирование</small></div></a><div><span>Служба бронирования</span><a href="tel:+78005550182">8 800 555-01-82</a><a href="mailto:stay@northstay.ru">stay@northstay.ru</a></div><div><span>Документы</span><a href="/booking">Правила проживания</a><a href="/booking">Политика обработки данных</a></div><Link className="staff-login" href="/">Вход для сотрудников</Link></footer>

      {selectedStay && <button className="booking-overlay" aria-label="Закрыть оформление" onClick={() => setSelectedStay(null)} />}
      {selectedStay && <aside className="checkout-drawer" aria-label="Оформление бронирования"><div className="checkout-head"><div><p className="booking-kicker">Прямое бронирование</p><h2>{selectedStay.name}</h2></div><button aria-label="Закрыть" onClick={() => setSelectedStay(null)}>Закрыть</button></div>
        {requestSent ? <div className="booking-success"><span>Заявка принята</span><h3>Остался один шаг</h3><p>Мы отправили подтверждение и защищённую ссылку на оплату. Объект удерживается за вами 30 минут.</p><dl><div><dt>Номер заявки</dt><dd>NS-240826</dd></div><div><dt>К оплате</dt><dd>{formatMoney(selectedStay.price * nights)}</dd></div><div><dt>Способ</dt><dd>{paymentProvider}</dd></div></dl><button onClick={() => setSelectedStay(null)}>Вернуться к объектам</button></div> : <form className="checkout-form" onSubmit={(event) => { event.preventDefault(); setRequestSent(true); }}>
          <div className="checkout-dates"><div><span>Заезд</span><strong>24 августа</strong><small>после 15:00</small></div><div><span>Выезд</span><strong>28 августа</strong><small>до 12:00</small></div></div>
          <div className="checkout-guests"><label>Имя и фамилия<input required placeholder="Как к вам обращаться" /></label><label>Телефон<input required type="tel" placeholder="+7 999 000-00-00" /></label><label>Электронная почта<input required type="email" placeholder="mail@example.ru" /></label></div>
          <fieldset><legend>Способ оплаты</legend><div className="payment-options">{["СБП", "ЮKassa", "Т-Банк", "CloudPayments"].map((provider) => <label className={paymentProvider === provider ? "selected" : ""} key={provider}><input type="radio" name="payment" checked={paymentProvider === provider} onChange={() => setPaymentProvider(provider)} />{provider}</label>)}</div></fieldset>
          <label className="agreement"><input required type="checkbox" />Я принимаю правила проживания и даю согласие на обработку персональных данных</label>
          <div className="checkout-total"><div><span>{formatMoney(selectedStay.price)} × {nights} ночи</span><strong>{formatMoney(selectedStay.price * nights)}</strong></div><div><span>Скидка за прямое бронирование</span><strong>−{formatMoney(Math.round(selectedStay.price * nights * .07))}</strong></div><div className="total-due"><span>К оплате</span><strong>{formatMoney(Math.round(selectedStay.price * nights * .93))}</strong></div></div>
          <button className="checkout-submit" type="submit">Подтвердить и перейти к оплате</button><small className="payment-note">Это демонстрационный экран: реальное списание не выполняется.</small>
        </form>}
      </aside>}
    </main>
  );
}
