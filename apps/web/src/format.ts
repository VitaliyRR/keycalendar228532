import type { Reservation } from './types';

export function money(minor: string | number | undefined, currency = 'RUB') {
  if (minor === undefined || minor === null || minor === '') return '—';
  try {
    const raw = BigInt(minor);
    const abs = raw < 0n ? -raw : raw;
    const units = abs / 100n;
    const cents = abs % 100n;
    const grouped = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${raw < 0n ? '−' : ''}${grouped}${cents ? `,${cents.toString().padStart(2, '0')}` : ''} ${currency === 'RUB' ? '₽' : currency}`;
  } catch { return '—'; }
}

export function dateRu(date: string | undefined) {
  if (!date) return '—';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

export function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
export function nights(checkin: string, checkout: string) {
  const a = new Date(`${checkin}T12:00:00Z`).getTime();
  const b = new Date(`${checkout}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
export function firstStay(reservation: Reservation) {
  return reservation.stays?.[0] || (reservation.unit_id && reservation.checkin && reservation.checkout ? { unit_id: reservation.unit_id, checkin: reservation.checkin, checkout: reservation.checkout } : undefined);
}
export function guestName(reservation: Reservation) { return reservation.guest?.display_name || reservation.guest?.name || reservation.guest_name || 'Гость не указан'; }
export const reservationStatus: Record<string,string> = {
  draft:'Черновик',request:'Заявка · даты свободны',confirmed:'Подтверждена',checked_in:'Проживает',checked_out:'Выезд',cancelled:'Отменена',no_show:'Не заехал',hold:'Временный hold'
};
export const syncStatus: Record<string,string> = {
  queued:'В очереди',in_progress:'Доставка идёт',confirmed:'Доставлено',conflict:'Конфликт',failed:'Ошибка доставки',not_applicable:'Локальная бронь',unknown:'Результат уточняется',local_only:'Локальная заявка'
};
export const stateLabels:Record<string,string>={
  active:'Активно',inactive:'Неактивно',open:'Открыта',in_progress:'В работе',review:'На проверке',done:'Завершено',completed:'Завершено',cancelled:'Отменено',pending:'Ожидает',queued:'В очереди',complete:'Готово',draft:'Черновик',failed:'Ошибка',error:'Ошибка',unknown:'Уточняется',read_only:'Только чтение',trial:'Пробный период',paid:'Оплачено',captured:'Получено',settled:'Получено',local_only:'Только локально',requested:'Запрошено',not_configured:'Не настроено'
};
export function statusClass(status?: string) {
  if (!status) return 'neutral';
  if (['confirmed','checked_in','completed','done','paid','active','acknowledged'].includes(status)) return 'positive';
  if (['cancelled','failed','error','conflict','rejected'].includes(status)) return 'negative';
  if (['pending','queued','in_progress','review','request','draft','unknown','read_only'].includes(status)) return 'warning';
  return 'neutral';
}
