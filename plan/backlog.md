# Backlog реализации

Канонические полные карточки: [backlog.json](backlog.json). Это план будущей разработки, не выполненные задачи. Каждая карточка содержит зависимости, результат, экраны, сущности, интеграции, ссылки, решения, приёмку, проверки, оценку и блокеры. Порядок ниже топологический; внутри независимых ветвей возможна параллельная работа.

Оценка: человеко-дни опытного инженера с review/QA, 6 продуктивных часов в день. Ожидание договоров не включено. Работы по одному компоненту нельзя считать готовыми отдельно от его тестов.

| Порядок | Задача | Этап | Результат | Зависимости | Проверка | Дни |
|---|---|---|---|---|---|---|
| 1 | TASK-OPS-005 | P1 | Окружения, выпуск и безопасные миграции схемы |  | TEST-OPS-005 | 4–8 |
| 2 | TASK-IAM-001 | P1 | Регистрация и подтверждение email | TASK-OPS-005 | TEST-IAM-001 | 3–6 |
| 3 | TASK-ORG-001 | P1 | Создание организации и первый запуск | TASK-IAM-001 | TEST-ORG-001 | 3–6 |
| 4 | TASK-ORG-002 | P1 | Переключение организаций и изоляция | TASK-ORG-001 | TEST-ORG-002 | 3–6 |
| 5 | TASK-IAM-004 | P1 | Приглашения и отзыв сотрудников | TASK-ORG-001 | TEST-IAM-004 | 3–6 |
| 6 | TASK-IAM-005 | P1 | Роли, права на объекты и операции | TASK-IAM-004 | TEST-IAM-005 | 3–6 |
| 7 | TASK-OBJ-001 | P1 | Карточка объекта и адрес | TASK-ORG-002, TASK-IAM-005 | TEST-OBJ-001 | 3–6 |
| 8 | TASK-OBJ-004 | P1 | Категории и отдельные номера | TASK-OBJ-001 | TEST-OBJ-004 | 3–6 |
| 9 | TASK-RTE-001 | P1 | Базовая цена, выходные и минимальный срок | TASK-OBJ-001 | TEST-RTE-001 | 3–7 |
| 10 | TASK-GST-001 | P1 | Справочник гостей и поиск | TASK-ORG-002, TASK-IAM-005 | TEST-GST-001 | 3–7 |
| 11 | TASK-RES-001 | P1 | Ручная бронь и предварительная заявка | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-001 | 4–8 |
| 12 | TASK-CAL-001 | P1 | Единая шахматка занятости | TASK-RES-001, TASK-RTE-001 | TEST-CAL-001 | 3–7 |
| 13 | TASK-CAL-002 | P1 | Выбор периода и переход к дате | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-002 | 2–4 |
| 14 | TASK-CAL-003 | P1 | Фильтры, поиск и сохраненные виды | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-003 | 3–7 |
| 15 | TASK-CAL-004 | P1 | Плотность календаря и обозначения источника | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-004 | 3–7 |
| 16 | TASK-CAL-005 | P1 | Создание через выделение диапазона | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-005 | 3–7 |
| 17 | TASK-CAL-006 | P1 | Блокировка продаж и буфер вокруг проживания | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-006 | 3–7 |
| 18 | TASK-CAL-007 | P1 | Обнаружение и разрешение пересечений | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-007 | 8–15 |
| 19 | TASK-CAL-008 | P2 | Работа с крупным портфелем | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-008 | 8–15 |
| 20 | TASK-CAL-009 | P2 | Просмотр календаря офлайн | TASK-RES-001, TASK-RTE-001, TASK-CAL-001 | TEST-CAL-009 | 3–7 |
| 21 | TASK-RES-002 | P1 | Карточка, изменение и перенос брони | TASK-RES-001 | TEST-RES-002 | 4–8 |
| 22 | TASK-RES-003 | P1 | Отмена, удаление из календаря и восстановление | TASK-RES-002 | TEST-RES-003 | 6–11 |
| 23 | TASK-INT-001 | P3 | Каталог подключений и доступ к провайдерам | TASK-IAM-005, TASK-OPS-005 | TEST-INT-001 | 6–12 |
| 24 | TASK-INT-002 | P3 | Сопоставление объектов, тарифов и источников истины | TASK-IAM-005, TASK-OPS-005, TASK-INT-001 | TEST-INT-002 | 6–12 |
| 25 | TASK-OPS-002 | P1 | Мониторинг и очередь ошибок | TASK-ORG-002 | TEST-OPS-002 | 4–8 |
| 26 | TASK-INT-003 | P3 | Надёжный обмен и конфликты каналов | TASK-IAM-005, TASK-OPS-005, TASK-INT-002, TASK-OPS-002 | TEST-INT-003 | 8–15 |
| 27 | TASK-RES-004 | P3 | Правила редактирования брони внешнего канала | TASK-RES-002, TASK-INT-003 | TEST-RES-004 | 4–8 |
| 28 | TASK-RES-005 | P1 | История изменения брони | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-005 | 4–8 |
| 29 | TASK-RES-006 | P1 | Реестр броней и расписание заездов/выездов | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-006 | 4–8 |
| 30 | TASK-RES-007 | P1 | Справочник источников | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-007 | 2–4 |
| 31 | TASK-OBJ-002 | P1 | Фотографии, описание и удобства | TASK-ORG-002, TASK-IAM-005, TASK-OBJ-001 | TEST-OBJ-002 | 3–6 |
| 32 | TASK-RTE-011 | P1 | Объяснение итоговой цены | TASK-RTE-001 | TEST-RTE-011 | 3–7 |
| 33 | TASK-RES-008 | P2 | Подборка объектов для гостя | TASK-OBJ-002, TASK-RTE-011 | TEST-RES-008 | 4–8 |
| 34 | TASK-RES-009 | P2 | Публичный модуль прямого бронирования | TASK-RTE-011, TASK-CAL-007, TASK-GST-001 | TEST-RES-009 | 8–15 |
| 35 | TASK-RES-010 | P2 | Настройки виджета и публичной витрины | TASK-RES-009 | TEST-RES-010 | 4–8 |
| 36 | TASK-RES-011 | P2 | Партнерский каталог и взаимная видимость | TASK-RES-001, TASK-IAM-005 | TEST-RES-011 | 4–8 |
| 37 | TASK-RES-012 | P2 | Дополнительные услуги и заявки гостя | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-012 | 4–8 |
| 38 | TASK-RES-013 | P2 | Фактическое заселение и выезд | TASK-OBJ-004, TASK-RTE-001, TASK-GST-001 | TEST-RES-013 | 4–8 |
| 39 | TASK-OBJ-003 | P1 | Правила проживания и сведения для гостя | TASK-ORG-002, TASK-IAM-005, TASK-OBJ-001 | TEST-OBJ-003 | 2–4 |
| 40 | TASK-OBJ-005 | P2 | Распределение неразобранных броней фонда | TASK-OBJ-004, TASK-RES-001, TASK-CAL-007 | TEST-OBJ-005 | 8–15 |
| 41 | TASK-OBJ-006 | P2 | Архивация и восстановление объектов | TASK-ORG-002, TASK-IAM-005, TASK-OBJ-001 | TEST-OBJ-006 | 3–6 |
| 42 | TASK-OBJ-007 | P2 | Объекты на карте | TASK-ORG-002, TASK-IAM-005, TASK-OBJ-001 | TEST-OBJ-007 | 3–6 |
| 43 | TASK-OBJ-008 | P2 | Служебные сведения, собственник и реквизиты | TASK-ORG-002, TASK-IAM-005, TASK-OBJ-001 | TEST-OBJ-008 | 3–6 |
| 44 | TASK-RTE-002 | P2 | Сезонные цены и привязка к объектам | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-002 | 3–7 |
| 45 | TASK-RTE-003 | P2 | Спецусловия на отдельные дни | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-003 | 3–7 |
| 46 | TASK-RTE-004 | P2 | Закрытие продаж, заезда и выезда | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-004 | 3–7 |
| 47 | TASK-RTE-005 | P2 | Массовое изменение цен и условий | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-005 | 3–7 |
| 48 | TASK-RTE-006 | P2 | Динамический минимальный срок и окна | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-006 | 3–7 |
| 49 | TASK-RTE-007 | P2 | Скидки за длительность | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-007 | 3–7 |
| 50 | TASK-RTE-008 | P2 | Доплата за взрослых и детские условия | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-008 | 3–7 |
| 51 | TASK-RTE-009 | P3 | Тарифы и наценки каналов | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-009 | 3–7 |
| 52 | TASK-RTE-010 | P2 | Промокоды прямого бронирования | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-010 | 3–7 |
| 53 | TASK-RTE-012 | P4 | Автоматический горизонт продаж | TASK-OBJ-001, TASK-RTE-001 | TEST-RTE-012 | 3–7 |
| 54 | TASK-GST-002 | P1 | История и показатели гостя | TASK-ORG-002, TASK-IAM-005, TASK-GST-001 | TEST-GST-002 | 3–7 |
| 55 | TASK-GST-003 | P2 | Экспорт базы гостей | TASK-ORG-002, TASK-IAM-005, TASK-GST-001 | TEST-GST-003 | 3–7 |
| 56 | TASK-GST-004 | P4 | Объединение дублей и ручной контакт | TASK-ORG-002, TASK-IAM-005, TASK-GST-001 | TEST-GST-004 | 3–7 |
| 57 | TASK-GST-005 | P2 | Приватная страница гостя | TASK-RES-001, TASK-IAM-005 | TEST-GST-005 | 3–7 |
| 58 | TASK-OPS-003 | P2 | Аудит и доступ поддержки | TASK-ORG-002, TASK-IAM-005 | TEST-OPS-003 | 4–8 |
| 59 | TASK-MIG-004 | P2 | Экспорт и права на скачивание | TASK-ORG-002, TASK-IAM-005 | TEST-MIG-004 | 5–10 |
| 60 | TASK-OPS-004 | P2 | Персональные данные, хранение и инциденты | TASK-ORG-002, TASK-OPS-003, TASK-MIG-004 | TEST-OPS-004 | 4–8 |
| 61 | TASK-GST-006 | P2 | Документы гостя и согласия | TASK-GST-005, TASK-OPS-004 | TEST-GST-006 | 3–7 |
| 62 | TASK-GST-007 | P2 | Договор и подтверждение условий | TASK-GST-006 | TEST-GST-007 | 3–7 |
| 63 | TASK-GST-008 | P2 | Заметки о госте и ограничения повторного приема | TASK-ORG-002, TASK-IAM-005, TASK-GST-001 | TEST-GST-008 | 3–7 |
| 64 | TASK-FIN-001 | P1 | Учетные счета и ручные платежи | TASK-RES-001 | TEST-FIN-001 | 5–10 |
| 65 | TASK-FIN-002 | P1 | Остаток, срок оплаты и переплата | TASK-RES-001, TASK-FIN-001 | TEST-FIN-002 | 5–10 |
| 66 | TASK-INT-004 | P3 | Платёжные адаптеры и сверка статусов | TASK-IAM-005, TASK-OPS-005, TASK-INT-001 | TEST-INT-004 | 6–12 |
| 67 | TASK-FIN-003 | P3 | Платежная ссылка и онлайн-предоплата | TASK-FIN-001, TASK-INT-004 | TEST-FIN-003 | 5–10 |
| 68 | TASK-FIN-004 | P1 | Реестр и сверка платежей | TASK-RES-001, TASK-FIN-001 | TEST-FIN-004 | 5–10 |
| 69 | TASK-FIN-005 | P3 | Залог: ручной учет и онлайн-операция | TASK-FIN-001, TASK-INT-004 | TEST-FIN-005 | 7–13 |
| 70 | TASK-FIN-006 | P3 | Возврат и удержание залога | TASK-FIN-005 | TEST-FIN-006 | 5–10 |
| 71 | TASK-FIN-007 | P1 | Расходы, статьи и распределение | TASK-RES-001, TASK-FIN-001 | TEST-FIN-007 | 5–10 |
| 72 | TASK-FIN-008 | P2 | Комиссии каналов | TASK-RES-001, TASK-FIN-001 | TEST-FIN-008 | 5–10 |
| 73 | TASK-FIN-009 | P3 | Возвраты проживания и фискальные документы | TASK-FIN-001, TASK-INT-004 | TEST-FIN-009 | 7–13 |
| 74 | TASK-FIN-010 | P2 | Подтверждение ручного перевода гостя | TASK-RES-001, TASK-FIN-001 | TEST-FIN-010 | 5–10 |
| 75 | TASK-REP-007 | P1 | Словарь показателей и контроль расхождений | TASK-FIN-001, TASK-RES-001 | TEST-REP-007 | 3–7 |
| 76 | TASK-REP-001 | P1 | Доходы, расходы и прибыль | TASK-REP-007 | TEST-REP-001 | 3–7 |
| 77 | TASK-REP-002 | P1 | Загрузка, ADR и RevPAR | TASK-FIN-001, TASK-RES-001 | TEST-REP-002 | 3–7 |
| 78 | TASK-REP-003 | P2 | Эффективность источников | TASK-FIN-001, TASK-RES-001 | TEST-REP-003 | 3–7 |
| 79 | TASK-REP-004 | P2 | Конверсия прямого модуля | TASK-FIN-001, TASK-RES-001 | TEST-REP-004 | 3–7 |
| 80 | TASK-REP-005 | P1 | Отчеты оплат и долга | TASK-FIN-001, TASK-RES-001 | TEST-REP-005 | 3–7 |
| 81 | TASK-REP-006 | P4 | Экспорт аналитики и воспроизводимый снимок | TASK-FIN-001, TASK-RES-001 | TEST-REP-006 | 3–7 |
| 82 | TASK-MSG-001 | P1 | Центр уведомлений команды | TASK-RES-001, TASK-IAM-005 | TEST-MSG-001 | 3–7 |
| 83 | TASK-MSG-002 | P2 | Настройки доставки сотруднику | TASK-RES-001, TASK-IAM-005, TASK-MSG-001 | TEST-MSG-002 | 2–4 |
| 84 | TASK-MSG-003 | P1 | Email-подтверждение бронирования | TASK-RES-001, TASK-IAM-005, TASK-MSG-001 | TEST-MSG-003 | 3–7 |
| 85 | TASK-MSG-004 | P2 | Шаблоны сообщений и переменные | TASK-RES-001, TASK-IAM-005, TASK-MSG-001 | TEST-MSG-004 | 3–7 |
| 86 | TASK-MSG-005 | P3 | Автосообщения по этапам проживания | TASK-MSG-004, TASK-INT-003 | TEST-MSG-005 | 3–7 |
| 87 | TASK-MSG-006 | P3 | Общий чат и чат бронирования | TASK-MSG-001, TASK-INT-001 | TEST-MSG-006 | 3–7 |
| 88 | TASK-MSG-007 | P3 | Журнал, повтор и резервный канал | TASK-MSG-005 | TEST-MSG-007 | 3–7 |
| 89 | TASK-MSG-008 | P3 | Сообщения с оплатой и приватным доступом | TASK-MSG-005, TASK-GST-005 | TEST-MSG-008 | 3–7 |
| 90 | TASK-GST-009 | P3 | Определение гостя при входящем звонке | TASK-GST-001, TASK-INT-001 | TEST-GST-009 | 3–7 |
| 91 | TASK-IAM-002 | P1 | Вход, сессии и выход | TASK-OPS-005, TASK-IAM-001 | TEST-IAM-002 | 3–6 |
| 92 | TASK-IAM-003 | P1 | Восстановление доступа и MFA | TASK-OPS-005, TASK-IAM-002 | TEST-IAM-003 | 3–6 |
| 93 | TASK-ORG-003 | P4 | Настройки, архив и удаление организации | TASK-IAM-001, TASK-ORG-002, TASK-MIG-004 | TEST-ORG-003 | 3–6 |
| 94 | TASK-BILL-001 | P2 | Тарифы, trial и лимиты SaaS | TASK-ORG-001 | TEST-BILL-001 | 4–8 |
| 95 | TASK-BILL-002 | P3 | Оплата и продление подписки | TASK-ORG-001, TASK-BILL-001, TASK-INT-004 | TEST-BILL-002 | 4–8 |
| 96 | TASK-BILL-003 | P3 | Просрочка, read-only и восстановление | TASK-ORG-001, TASK-BILL-002 | TEST-BILL-003 | 4–8 |
| 97 | TASK-MIG-001 | P2 | Импорт и сопоставление данных | TASK-ORG-002, TASK-IAM-005 | TEST-MIG-001 | 5–10 |
| 98 | TASK-MIG-002 | P2 | Dry-run и сверка миграции | TASK-ORG-002, TASK-IAM-005, TASK-MIG-001 | TEST-MIG-002 | 5–10 |
| 99 | TASK-OPS-001 | P4 | Резервное копирование и восстановление | TASK-ORG-002 | TEST-OPS-001 | 8–15 |
| 100 | TASK-MIG-003 | P4 | Переключение первого клиента и откат | TASK-ORG-002, TASK-IAM-005, TASK-MIG-002, TASK-INT-003, TASK-OPS-001 | TEST-MIG-003 | 8–15 |
| 101 | TASK-OPS-006 | P4 | Производительность и доступность | TASK-ORG-002, TASK-OPS-002 | TEST-OPS-006 | 4–8 |
| 102 | TASK-OPS-010 | P2 | Расписание уборок и готовность объекта | TASK-ORG-002, TASK-IAM-005 | TEST-OPS-010 | 4–8 |
| 103 | TASK-OPS-011 | P2 | Поломки, закупки и дополнительные задания | TASK-ORG-002, TASK-OPS-010 | TEST-OPS-011 | 4–8 |
| 104 | TASK-OPS-012 | P2 | Начисления и оценки уборок | TASK-OPS-010, TASK-FIN-001 | TEST-OPS-012 | 4–8 |
| 105 | TASK-OPS-013 | P2 | Показания счётчиков | TASK-ORG-002, TASK-OPS-011 | TEST-OPS-013 | 4–8 |
| 106 | TASK-OPS-014 | P2 | Защищённые коды доступа и инструкции персонала | TASK-OPS-010, TASK-GST-005 | TEST-OPS-014 | 4–8 |
| 107 | TASK-OPS-015 | P2 | Панель операционных задач менеджера | TASK-OPS-010, TASK-FIN-001, TASK-OPS-011 | TEST-OPS-015 | 4–8 |

## Конкретные подключения и фискальные профили

75 найденных позиций покрыты отдельными задачами. Это не 75 прямых API-адаптеров: 15 фискальных сервисов являются профилями цепочки Монеты; historical/unknown и AI-сервис Гами имеют отдельный discovery. Наличие задачи не подтверждает доступ.

| Задача | Сервис и результат | Объём | Паспорт | Дни после общего ядра |
|---|---|---|---|---|
| TASK-ADP-101HOTELS | 101Hotels: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-101HOTELS.md) | 6–14 |
| TASK-ADP-APARTSHARING | Apart Sharing: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-APARTSHARING.md) | 6–14 |
| TASK-ADP-AVITO | Авито: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-AVITO.md) | 6–14 |
| TASK-ADP-BOOKING | Booking.com: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-BOOKING.md) | 6–14 |
| TASK-ADP-BRONEVIK | Броневик: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-BRONEVIK.md) | 6–14 |
| TASK-ADP-CIAN | Циан: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-CIAN.md) | 6–14 |
| TASK-ADP-EDEMVGOSTI | Едем-в-Гости.ру: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-EDEMVGOSTI.md) | 6–14 |
| TASK-ADP-OSTROVOK | Островок: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-OSTROVOK.md) | 6–14 |
| TASK-ADP-EMERGINGTRAVEL | Emerging Travel: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-EMERGINGTRAVEL.md) | 6–14 |
| TASK-ADP-EXPEDIA | Expedia: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-EXPEDIA.md) | 6–14 |
| TASK-ADP-FORENTO | Forento.ru / Vkrim.info: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-FORENTO.md) | 6–14 |
| TASK-ADP-HOTELBOOK | Hotelbook: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-HOTELBOOK.md) | 6–14 |
| TASK-ADP-KUFAR | Kufar.by: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-KUFAR.md) | 6–14 |
| TASK-ADP-KVARTIRKA | Квартирка: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-KVARTIRKA.md) | 6–14 |
| TASK-ADP-ONETWOTRIP | OneTwoTrip: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ONETWOTRIP.md) | 6–14 |
| TASK-ADP-OTELLO | Отелло: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-OTELLO.md) | 6–14 |
| TASK-ADP-OZONTRAVEL | Ozon Travel: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-OZONTRAVEL.md) | 6–14 |
| TASK-ADP-ROOMOOK | Roomook: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ROOMOOK.md) | 6–14 |
| TASK-ADP-SUTOCHNO | Суточно.ру: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-SUTOCHNO.md) | 6–14 |
| TASK-ADP-TUTU | Туту: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-TUTU.md) | 6–14 |
| TASK-ADP-ROOMLINK | Roomlink (ранее Забронируй.ру): доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ROOMLINK.md) | 6–14 |
| TASK-ADP-VEZDEKAKDOMA | Везде как дома: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-VEZDEKAKDOMA.md) | 6–14 |
| TASK-ADP-GDEKVARTIRA | ГдеКвартира.су: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-GDEKVARTIRA.md) | 6–14 |
| TASK-ADP-DOMKLIK24 | Домклик24: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-DOMKLIK24.md) | 6–14 |
| TASK-ADP-ZHILIBYLI | ЖилиБыли: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ZHILIBYLI.md) | 6–14 |
| TASK-ADP-PRIVETTUR | ПриветТур!: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-PRIVETTUR.md) | 6–14 |
| TASK-ADP-CBOOKING | Cbooking.ru: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-CBOOKING.md) | 6–14 |
| TASK-ADP-TVIL | ТВИЛ: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-TVIL.md) | 6–14 |
| TASK-ADP-YANDEXTRAVEL | Яндекс Путешествия: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-YANDEXTRAVEL.md) | 6–14 |
| TASK-ADP-TRIPVENUE | Трипвеню: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-TRIPVENUE.md) | 6–14 |
| TASK-ADP-KURORTIX | Миртурбаз / Kurortix: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-KURORTIX.md) | 6–14 |
| TASK-ADP-ALEAN | Алеан: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ALEAN.md) | 6–14 |
| TASK-ADP-LIGAKVARTIR | Лига Квартир: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-LIGAKVARTIR.md) | 2–5 |
| TASK-ADP-AIRBNB | Airbnb: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-AIRBNB.md) | 2–5 |
| TASK-ADP-REALT | Realt: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-REALT.md) | 2–5 |
| TASK-ADP-GOOGLECALENDAR | Google Calendar: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-GOOGLECALENDAR.md) | 2–5 |
| TASK-ADP-MONETA-PERSONAL | Монета для физических лиц: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-MONETA-PERSONAL.md) | 8–18 |
| TASK-ADP-MONETA-BUSINESS | Монета для ИП и юридических лиц: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-MONETA-BUSINESS.md) | 8–18 |
| TASK-ADP-AMOCRM | amoCRM: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-AMOCRM.md) | 6–14 |
| TASK-ADP-BITRIX24 | Битрикс24: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-BITRIX24.md) | 6–14 |
| TASK-ADP-OKIDOKI | ОкиДоки: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-OKIDOKI.md) | 6–14 |
| TASK-ADP-TTLOCK | TTLock: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-TTLOCK.md) | 6–14 |
| TASK-ADP-ROOMSHARING | Roomsharing Norke: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ROOMSHARING.md) | 6–14 |
| TASK-ADP-WEBHOOKS | Исходящие webhook: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-WEBHOOKS.md) | 6–14 |
| TASK-ADP-WHATSAPP | WhatsApp в автосообщениях: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-WHATSAPP.md) | 6–14 |
| TASK-ADP-MAX | MAX в автосообщениях: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-MAX.md) | 6–14 |
| TASK-ADP-TELEGRAM | Telegram в автосообщениях: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-TELEGRAM.md) | 6–14 |
| TASK-ADP-EMAIL | Email в автосообщениях: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-EMAIL.md) | 6–14 |
| TASK-ADP-SMSGATE | SMS Gate / Android SMS: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-SMSGATE.md) | 6–14 |
| TASK-ADP-REDATA | REDATA: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-REDATA.md) | 6–14 |
| TASK-ADP-YOOKASSA | ЮKassa: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-YOOKASSA.md) | 8–18 |
| TASK-ADP-KVARTIRKA-ICAL | Квартирка / kv.link (iCal): доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-KVARTIRKA-ICAL.md) | 2–5 |
| TASK-ADP-QQRENTA | api.qqrenta.ru: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-QQRENTA.md) | 1–3 |
| TASK-ADP-ICAL | Универсальный iCalendar: доступ, адаптер и сертификация | conditional_connector | [паспорт](../integrations/passports/INT-ICAL.md) | 2–5 |
| TASK-ADP-GAMI | Гами (заявление внешнего поставщика): проверить доступ и согласовать необязательный AI-сценарий | optional_discovery_until_scope_agreed | [паспорт](../integrations/passports/INT-GAMI.md) | 1–3 |
| TASK-ADP-RENTYSOFT | RentySoft: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-RENTYSOFT.md) | 1–3 |
| TASK-ADP-FLATSHARING | Flatsharing: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-FLATSHARING.md) | 1–3 |
| TASK-ADP-KUKURENTA | Кукурента: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-KUKURENTA.md) | 1–3 |
| TASK-ADP-NOCHLEG24 | Nochleg24: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-NOCHLEG24.md) | 1–3 |
| TASK-ADP-LOKAL | Локал: выяснить действующий статус и договор | discovery_only_until_confirmed | [паспорт](../integrations/passports/INT-LOKAL.md) | 1–3 |
| TASK-ADP-KOMTET | Комтет: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-KOMTET.md) | 1–3 |
| TASK-ADP-BUSINESSRU | Бизнес.ру Онлайн-Чеки: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-BUSINESSRU.md) | 1–3 |
| TASK-ADP-CLOUDKASSIR | CloudKassir: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-CLOUDKASSIR.md) | 1–3 |
| TASK-ADP-LIFEPAY | Life Pay: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-LIFEPAY.md) | 1–3 |
| TASK-ADP-ATOL | Атол: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-ATOL.md) | 1–3 |
| TASK-ADP-EVOTOR | Эвотор: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-EVOTOR.md) | 1–3 |
| TASK-ADP-FERMA | Ferma: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-FERMA.md) | 1–3 |
| TASK-ADP-FIRSTOFD | Первый ОФД: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-FIRSTOFD.md) | 1–3 |
| TASK-ADP-KITONLINE | Kit online: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-KITONLINE.md) | 1–3 |
| TASK-ADP-ORANGEDATA | Orange Data: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-ORANGEDATA.md) | 1–3 |
| TASK-ADP-SBIS | СБИС: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-SBIS.md) | 1–3 |
| TASK-ADP-DIGITALKASSA | Digital Kassa: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-DIGITALKASSA.md) | 1–3 |
| TASK-ADP-MODULKASSA | МодульКасса: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-MODULKASSA.md) | 1–3 |
| TASK-ADP-PLATFORMAOFD | Платформа ОФД: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-PLATFORMAOFD.md) | 1–3 |
| TASK-ADP-TAXCOMOFD | Такском ОФД: совместимость и настройка фискальной цепочки через Монету | fiscal_configuration_profile_not_direct_adapter | [паспорт](../integrations/passports/INT-TAXCOMOFD.md) | 1–3 |

## Диапазон оценки

104 обязательные функциональные/SaaS-задачи: 409–846 человеко-дней. 3 отдельных дополнительных улучшения: 9–21 человеко-дней (RTE-012, GST-004, REP-006); они не входят в воротa обязательного паритета. Все подключения, fiscal profiles и discovery: ещё 322–766 человеко-дней при готовом общем ядре и полученном доступе. Это грубая сумма карточек с возможным пересечением общих работ, не контрактная стоимость и не календарное обещание. После декомпозиции убрать двойной учёт общего компонента; добавить резерв 25% на совместимость, безопасность и пилот.

Пилот использует согласованный набор первого клиента и приоритетно прорабатывает Авито/Суточно.ру. Полный паритет не объявляется до закрытия всей применимой матрицы. 15 fiscal profiles не требуют одновременного подключения 15 касс; каждый профиль получает подтверждённую совместимость либо явно документированное ограничение. Доступы/сертификация имеют отдельный календарный путь.

## Обязательный объём и дополнительные улучшения

Поле delivery_class является каноническим: mandatory_parity — обязательный паритет, mandatory_platform — обязательный SaaS, optional_enhancement — дополнительное улучшение. REQ-RTE-012, REQ-GST-004 и REQ-REP-006 предлагаются отдельно после обязательного объёма. source_category описывает достоверность сведений, а не обязательность задачи. Предложенная платформенная изоляция обязательна, даже если она не заявлена как свойство RealtyCalendar.
