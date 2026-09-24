# Реестр функций продукта-ориентира

Дата: 24 сентября 2026. Полная спецификация состоит из двух реестров: [reference.json](reference.json) и [saas.json](saas.json). Доказательства: [источники](../research/reference-evidence.json), [наблюдения аккаунта](../research/account-observations.md).

В reference.json 76 требований: **5 account**, **67 documented**, **4 proposed**. В saas.json еще 31 требование. Полный комплект: **107 требований**, из них **78 mandatory_parity**, **26 mandatory_platform**, **3 optional_enhancement**; категории доказательств: **5 account**, **73 documented**, **29 proposed**. Реализация всех функций not_started.

Только source_behavior и account_observation описывают ориентир. Account подтверждает точно названное чтение; наличие формы не подтверждает сохранение/отправку/платеж/синхронизацию. Прочие поля задают целевой KC. delivery_class: mandatory_parity, mandatory_platform, optional_enhancement.

Канонические роли: [access-control.md](../architecture/access-control.md); финансовая роль accountant. Роль не заменяет отдельное разрешение и scope. Guest имеет доступ к одной брони. P1 — ядро, P2 — расширенный паритет, P3 — внешние сценарии, P4 — выпуск/расширения.

[Единый паритет CSV](parity.csv):78 строк (72 из reference.json и 6 Autopilot из saas.json); [проектные требования](proposed.csv):4, включая обязательную производительность. Самостоятельные расширения: REQ-RTE-012, REQ-GST-004, REQ-REP-006.

| Требование | Возможность | Категория | Класс поставки | Экран | Этап | Источники |
|---|---|---|---|---|---|---|
| REQ-CAL-001 | Единая шахматка занятости | account | mandatory_parity | SCR-CAL-01 | P1 | DOC-001, ACC-002 |
| REQ-CAL-002 | Выбор периода и переход к дате | account | mandatory_parity | SCR-CAL-01 | P1 | ACC-002 |
| REQ-CAL-003 | Фильтры и поиск объектов | account | mandatory_parity | SCR-CAL-01 | P1 | ACC-004 |
| REQ-CAL-004 | Плотность календаря и обозначения источника | documented | mandatory_parity | SCR-CAL-02 | P1 | DOC-004, DOC-013, ACC-002, ACC-003, ACC-007 |
| REQ-CAL-005 | Создание через выделение диапазона | documented | mandatory_parity | SCR-CAL-01 | P1 | DOC-003 |
| REQ-CAL-006 | Блокировка продаж и буфер вокруг проживания | documented | mandatory_parity | SCR-CAL-03 | P1 | DOC-008, DOC-003 |
| REQ-CAL-007 | Обнаружение и разрешение пересечений | documented | mandatory_parity | SCR-CAL-04 | P1 | DOC-003, DOC-006 |
| REQ-CAL-008 | Работа с крупным портфелем | proposed | mandatory_platform | SCR-CAL-01 | P2 | Проект |
| REQ-CAL-009 | Просмотр календаря офлайн | documented | mandatory_parity | SCR-CAL-01 | P2 | DOC-027 |
| REQ-RES-001 | Ручная бронь и предварительная заявка | documented | mandatory_parity | SCR-RES-02 | P1 | DOC-003 |
| REQ-RES-002 | Карточка, изменение и перенос брони | documented | mandatory_parity | SCR-RES-03 | P1 | DOC-003 |
| REQ-RES-003 | Отмена, удаление из календаря и восстановление | documented | mandatory_parity | SCR-RES-04 | P1 | DOC-003, ACC-003 |
| REQ-RES-004 | Правила редактирования брони внешнего канала | documented | mandatory_parity | SCR-RES-03 | P3 | DOC-003, DOC-026 |
| REQ-RES-005 | История изменения брони | documented | mandatory_parity | SCR-RES-05 | P1 | DOC-003 |
| REQ-RES-006 | Реестр броней и расписание заездов/выездов | account | mandatory_parity | SCR-RES-01, SCR-RES-06 | P1 | DOC-001, DOC-012, ACC-005, ACC-006 |
| REQ-RES-007 | Справочник источников | documented | mandatory_parity | SCR-RES-07 | P1 | DOC-004, ACC-007 |
| REQ-RES-008 | Подборка объектов для гостя | documented | mandatory_parity | SCR-RES-08 | P2 | DOC-018 |
| REQ-RES-009 | Публичный модуль прямого бронирования | documented | mandatory_parity | SCR-RES-09 | P2 | DOC-020 |
| REQ-RES-010 | Настройки виджета и публичной витрины | documented | mandatory_parity | SCR-RES-10 | P2 | DOC-020 |
| REQ-RES-011 | Партнерский каталог и взаимная видимость | documented | mandatory_parity | SCR-RES-11 | P2 | DOC-019, ACC-PART-01 |
| REQ-RES-012 | Дополнительные услуги и заявки гостя | documented | mandatory_parity | SCR-RES-12 | P2 | DOC-024 |
| REQ-RES-013 | Фактическое заселение и выезд | documented | mandatory_parity | SCR-RES-06 | P2 | DOC-024 |
| REQ-OBJ-001 | Карточка объекта и адрес | documented | mandatory_parity | SCR-OBJ-02 | P1 | DOC-005, ACC-OBJ-01 |
| REQ-OBJ-002 | Фотографии, описание и удобства | documented | mandatory_parity | SCR-OBJ-02 | P1 | DOC-005, ACC-OBJ-01 |
| REQ-OBJ-003 | Правила проживания и сведения для гостя | documented | mandatory_parity | SCR-OBJ-03 | P1 | DOC-005, DOC-024 |
| REQ-OBJ-004 | Категории и отдельные номера | documented | mandatory_parity | SCR-OBJ-04 | P1 | DOC-006 |
| REQ-OBJ-005 | Распределение неразобранных броней фонда | documented | mandatory_parity | SCR-OBJ-04 | P2 | DOC-006 |
| REQ-OBJ-006 | Архивация и восстановление объектов | documented | mandatory_parity | SCR-OBJ-01 | P2 | DOC-014 |
| REQ-OBJ-007 | Объекты на карте | documented | mandatory_parity | SCR-OBJ-05 | P2 | DOC-020 |
| REQ-OBJ-008 | Служебные сведения, собственник и реквизиты | documented | mandatory_parity | SCR-OBJ-06 | P2 | DOC-005, DOC-028 |
| REQ-RTE-001 | Базовая цена, выходные и минимальный срок | documented | mandatory_parity | SCR-RTE-01 | P1 | DOC-005, DOC-007, ACC-OBJ-01 |
| REQ-RTE-002 | Сезонные цены и привязка к объектам | documented | mandatory_parity | SCR-RTE-02 | P2 | DOC-007, ACC-007 |
| REQ-RTE-003 | Спецусловия на отдельные дни | documented | mandatory_parity | SCR-RTE-03 | P2 | DOC-008 |
| REQ-RTE-004 | Закрытие продаж, заезда и выезда | documented | mandatory_parity | SCR-RTE-03 | P2 | DOC-008 |
| REQ-RTE-005 | Массовое изменение цен и условий | documented | mandatory_parity | SCR-RTE-04 | P2 | DOC-002, DOC-008, ACC-003 |
| REQ-RTE-006 | Динамический минимальный срок и окна | documented | mandatory_parity | SCR-RTE-05 | P2 | DOC-007, DOC-006, ACC-007 |
| REQ-RTE-007 | Скидки за длительность | documented | mandatory_parity | SCR-RTE-01, SCR-RTE-02 | P2 | DOC-009 |
| REQ-RTE-008 | Доплата за взрослых и детские условия | documented | mandatory_parity | SCR-RTE-06 | P2 | DOC-010, DOC-020 |
| REQ-RTE-009 | Тарифы и наценки каналов | documented | mandatory_parity | SCR-RTE-07 | P3 | DOC-011, ACC-RTE-01, ACC-CHAN-01, ACC-CHAN-02 |
| REQ-RTE-010 | Промокоды прямого бронирования | documented | mandatory_parity | SCR-RTE-08 | P2 | DOC-020 |
| REQ-RTE-011 | Объяснение итоговой цены | documented | mandatory_parity | SCR-RTE-09 | P1 | DOC-007, DOC-008 |
| REQ-RTE-012 | Автоматический горизонт продаж | proposed | optional_enhancement | SCR-RTE-05 | P4 | Проект |
| REQ-GST-001 | Справочник гостей и поиск | documented | mandatory_parity | SCR-GST-01 | P1 | DOC-012 |
| REQ-GST-002 | История и показатели гостя | documented | mandatory_parity | SCR-GST-02 | P1 | DOC-012 |
| REQ-GST-003 | Экспорт базы гостей | documented | mandatory_parity | SCR-GST-01 | P2 | DOC-012 |
| REQ-GST-004 | Объединение дублей и ручной контакт | proposed | optional_enhancement | SCR-GST-02 | P4 | Проект |
| REQ-GST-005 | Приватная страница гостя | documented | mandatory_parity | SCR-GST-03 | P2 | DOC-024 |
| REQ-GST-006 | Документы гостя и согласия | documented | mandatory_parity | SCR-GST-04 | P2 | DOC-001, DOC-024 |
| REQ-GST-007 | Договор и подтверждение условий | documented | mandatory_parity | SCR-GST-05 | P2 | DOC-024 |
| REQ-GST-008 | Заметки о госте и ограничения повторного приема | documented | mandatory_parity | SCR-GST-02 | P2 | DOC-027 |
| REQ-FIN-001 | Учетные счета и ручные платежи | documented | mandatory_parity | SCR-FIN-01, SCR-FIN-02 | P1 | DOC-013 |
| REQ-FIN-002 | Остаток, срок оплаты и переплата | documented | mandatory_parity | SCR-FIN-02 | P1 | DOC-013, ACC-005 |
| REQ-FIN-003 | Платежная ссылка и онлайн-предоплата | documented | mandatory_parity | SCR-FIN-03 | P3 | DOC-020, DOC-028, ACC-PAY-01 |
| REQ-FIN-004 | Реестр и сверка платежей | documented | mandatory_parity | SCR-FIN-01 | P1 | DOC-013 |
| REQ-FIN-005 | Залог: ручной учет и онлайн-операция | documented | mandatory_parity | SCR-FIN-04 | P3 | DOC-015, ACC-FIN-01, ACC-PAY-01 |
| REQ-FIN-006 | Возврат и удержание залога | documented | mandatory_parity | SCR-FIN-04 | P3 | DOC-015, ACC-FIN-01 |
| REQ-FIN-007 | Расходы, статьи и распределение | documented | mandatory_parity | SCR-FIN-05 | P1 | DOC-014 |
| REQ-FIN-008 | Комиссии каналов | documented | mandatory_parity | SCR-FIN-06 | P2 | DOC-016, DOC-028 |
| REQ-FIN-009 | Возвраты проживания и фискальные документы | documented | mandatory_parity | SCR-FIN-03, SCR-FIN-07 | P3 | DOC-028 |
| REQ-FIN-010 | Подтверждение ручного перевода гостя | documented | mandatory_parity | SCR-FIN-08 | P2 | DOC-024 |
| REQ-REP-001 | Доходы, расходы и прибыль | documented | mandatory_parity | SCR-REP-01 | P1 | DOC-016, ACC-REP-01 |
| REQ-REP-002 | Загрузка, ADR и RevPAR | account | mandatory_parity | SCR-REP-01 | P1 | DOC-016, ACC-REP-01 |
| REQ-REP-003 | Эффективность источников | documented | mandatory_parity | SCR-REP-02 | P2 | DOC-004 |
| REQ-REP-004 | Конверсия прямого модуля | documented | mandatory_parity | SCR-REP-03 | P2 | DOC-021 |
| REQ-REP-005 | Отчеты оплат и долга | documented | mandatory_parity | SCR-REP-01 | P1 | DOC-013 |
| REQ-REP-006 | Экспорт аналитики и воспроизводимый снимок | proposed | optional_enhancement | SCR-REP-04 | P4 | Проект |
| REQ-REP-007 | Словарь показателей и контроль расхождений | documented | mandatory_parity | SCR-REP-04 | P1 | DOC-016 |
| REQ-MSG-001 | Центр уведомлений команды | documented | mandatory_parity | SCR-MSG-01 | P1 | DOC-017 |
| REQ-MSG-002 | Настройки доставки сотруднику | documented | mandatory_parity | SCR-MSG-02 | P2 | DOC-017, DOC-025, ACC-007 |
| REQ-MSG-003 | Email-подтверждение бронирования | documented | mandatory_parity | SCR-MSG-03 | P1 | DOC-012 |
| REQ-MSG-004 | Шаблоны сообщений и переменные | documented | mandatory_parity | SCR-MSG-04 | P2 | DOC-022 |
| REQ-MSG-005 | Автосообщения по этапам проживания | documented | mandatory_parity | SCR-MSG-04 | P3 | DOC-022, DOC-023 |
| REQ-MSG-006 | Общий чат и чат бронирования | documented | mandatory_parity | SCR-MSG-05 | P3 | DOC-022 |
| REQ-MSG-007 | Журнал, повтор и резервный канал | documented | mandatory_parity | SCR-MSG-06 | P3 | DOC-022, DOC-023 |
| REQ-MSG-008 | Сообщения с оплатой и приватным доступом | documented | mandatory_parity | SCR-MSG-04 | P3 | DOC-022, DOC-024, DOC-029 |
| REQ-GST-009 | Определение гостя при входящем звонке | documented | mandatory_parity | SCR-GST-02 | P3 | DOC-030 |


## Обязательный паритет Автопилота из SaaS-реестра

Эти 6 требований определены в [saas.json](saas.json), а не дублируются в reference.json. Они включены в единую таблицу parity.csv. Остальные 25 SaaS-требований вместе с REQ-CAL-008 составляют 26 обязательных требований платформы.

| Требование | Возможность | Экран | Этап | Источник |
|---|---|---|---|---|
| REQ-OPS-010 | Расписание уборок и готовность объекта | SCR-OPS-02 | P2 | DOC-024 |
| REQ-OPS-011 | Поломки, закупки и дополнительные задания | SCR-OPS-03 | P2 | DOC-024 |
| REQ-OPS-012 | Начисления и оценки уборок | SCR-OPS-05 | P2 | DOC-024 |
| REQ-OPS-013 | Показания счётчиков | SCR-OPS-06 | P2 | DOC-024 |
| REQ-OPS-014 | Защищённые коды доступа и инструкции персонала | SCR-OPS-03 | P2 | DOC-024 |
| REQ-OPS-015 | Панель операционных задач менеджера | SCR-OPS-02 | P2 | DOC-024 |
