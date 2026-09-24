// Stable screen IDs correspond to design/screens.json. Each screen has an actual data surface;
// a family page can render several related screen IDs with a different view configuration.
export interface Screen {
  id: string;
  title: string;
  group: string;
  resource?: string;
}

const groups: Array<{ group: string; entries: Array<[string, string, string?]> }> = [
  { group: 'Шахматка', entries: [
    ['SCR-CAL-01','Шахматка','calendar'],['SCR-CAL-02','Вид и фильтры','calendar'],['SCR-CAL-03','Блокировка дат','availability-blocks'],['SCR-CAL-04','Конфликты занятости','sync-conflicts']
  ]},
  { group: 'Бронирования', entries: [
    ['SCR-RES-01','Реестр бронирований','reservations'],['SCR-RES-02','Новое бронирование','reservations'],['SCR-RES-03','Карточка бронирования','reservations'],['SCR-RES-04','Отмена и восстановление','reservations'],['SCR-RES-05','История бронирования','audit'],['SCR-RES-06','Заезды и выезды','reservations'],['SCR-RES-07','Источники бронирования','reports'],['SCR-RES-08','Подборка для гостя','collections'],['SCR-RES-09','Прямое бронирование','public-booking'],['SCR-RES-10','Модуль бронирования','public-booking'],['SCR-RES-11','Партнёры и доступ','partners'],['SCR-RES-12','Дополнительные услуги','services']
  ]},
  { group: 'Объекты', entries: [
    ['SCR-OBJ-01','Объекты и номера','properties'],['SCR-OBJ-02','Карточка объекта','properties'],['SCR-OBJ-03','Правила проживания','properties'],['SCR-OBJ-04','Номерной фонд','properties'],['SCR-OBJ-05','Объекты на карте','properties'],['SCR-OBJ-06','Реквизиты объекта','properties']
  ]},
  { group: 'Цены и правила', entries: [
    ['SCR-RTE-01','Базовые цены','rates'],['SCR-RTE-02','Сезоны','rate-plans'],['SCR-RTE-03','Ограничения проживания','rate-plans'],['SCR-RTE-04','Массовое изменение цен','rates'],['SCR-RTE-05','Динамика и горизонт','rates'],['SCR-RTE-06','Состав гостей','rate-plans'],['SCR-RTE-07','Тарифы каналов','connections'],['SCR-RTE-08','Промокоды','promotions'],['SCR-RTE-09','Расчёт стоимости','quotes']
  ]},
  { group: 'Гости', entries: [
    ['SCR-GST-01','Гости','guests'],['SCR-GST-02','Профиль гостя','guests'],['SCR-GST-03','Кабинет гостя','guest-portal'],['SCR-GST-04','Документы и согласия','guests'],['SCR-GST-05','Договор с гостем','guests']
  ]},
  { group: 'Финансы', entries: [
    ['SCR-FIN-01','Платежи и счета','payments'],['SCR-FIN-02','Ручной платёж','payments'],['SCR-FIN-03','Ссылки и возвраты','refunds'],['SCR-FIN-04','Залоги','deposits'],['SCR-FIN-05','Расходы','expenses'],['SCR-FIN-06','Комиссии каналов','ledger'],['SCR-FIN-07','Чеки','receipts'],['SCR-FIN-08','Проверка перевода','payment-intents']
  ]},
  { group: 'Отчёты', entries: [
    ['SCR-REP-01','Финансы и загрузка','reports'],['SCR-REP-02','Источники и каналы','reports'],['SCR-REP-03','Статистика модуля','reports'],['SCR-REP-04','Показатели и экспорт','reports']
  ]},
  { group: 'Задачи', entries: [
    ['SCR-OPS-02','Задачи на сегодня','tasks'],['SCR-OPS-03','Карточка задачи','tasks'],['SCR-OPS-05','Начисления сотрудникам','payroll'],['SCR-OPS-06','Показания счётчиков','meter-readings']
  ]},
  { group: 'Каналы', entries: [
    ['SCR-INT-01','Подключения','connections'],['SCR-INT-02','Сопоставление объектов','connections'],['SCR-INT-03','Платёжные системы','connections'],['SCR-INT-04','Ошибки обмена','sync-conflicts']
  ]},
  { group: 'Сообщения', entries: [
    ['SCR-MSG-01','Уведомления','notifications'],['SCR-MSG-02','Правила доставки','notification-preferences'],['SCR-MSG-03','Подтверждение бронирования','notifications'],['SCR-MSG-04','Автосообщения','message-templates'],['SCR-MSG-05','Диалог с гостем','messages'],['SCR-MSG-06','Журнал доставки','notifications']
  ]},
  { group: 'Сотрудники', entries: [['SCR-IAM-03','Сотрудники и права','staff']] },
  { group: 'Настройки', entries: [
    ['SCR-ORG-01','Рабочие пространства','organizations'],['SCR-ORG-02','Настройки организации','organizations'],['SCR-MIG-01','Импорт и экспорт','import-batches'],['SCR-MIG-02','Проверка переноса','import-batches'],['SCR-MIG-03','Пилот и переключение','import-batches'],['SCR-BILL-01','Подписка и лимиты','subscription'],['SCR-BILL-02','Оплата подписки','subscription'],['SCR-BILL-03','Счета подписки','subscription'],['SCR-BILL-04','Ограниченный режим','subscription']
  ]},
  { group: 'Контроль платформы', entries: [
    ['SCR-OPS-01','Состояние сервиса','health'],['SCR-OPS-04','Данные и инциденты','audit'],['SCR-OPS-07','Аудит и доступ поддержки','audit']
  ]}
];

export const screens: Screen[] = groups.flatMap(({ group, entries }) => entries.map(([id,title,resource]) => ({ id,title,group,resource })));
export const screenMap = new Map(screens.map(screen => [screen.id, screen]));
export const primaryScreens = groups.map(({group,entries}) => ({ group, id: entries[0][0] }));
export const groupScreens = (group: string) => screens.filter(screen => screen.group === group);
export const screenPath = (orgId: string, screenId: string, entityId?: string) => `/o/${encodeURIComponent(orgId)}/${screenId}${entityId ? `/${encodeURIComponent(entityId)}` : ''}`;
