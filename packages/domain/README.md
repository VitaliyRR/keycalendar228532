# @keycalendar/domain

Чистые доменные функции для API и фоновых процессов KeyCalendar. Пакет не обращается к сети или БД, не создает пользователей, платежи, брони или интеграции. Он проверяет и рассчитывает входной снимок; сервис должен читать его внутри tenant-scoped транзакции и закреплять результат в PostgreSQL.

## Сборка и проверка

Node.js 24, TypeScript ESM:

```sh
npm install
npm test
```

`npm test` собирает TypeScript и запускает `node:test`. Основной импорт: `import { buildQuote, planAllocation, financialTotals } from "@keycalendar/domain"`.

## Основные exports

| Область | Функции | Контракт |
|---|---|---|
| Даты | `parseLocalDate`, `stayRange`, `nightsBetween`, `addDays`, `rangesOverlap`, `effectiveStayRange`, `nightDates` | Локальные ISO даты, ночи `[from,to)`; UTC timestamp отдельно через `parseInstant` |
| Доступность | `planAllocation`, `planCategoryAllocation` | Чистый all-or-nothing план по атомарным ресурсам; возвращает sorted `lockResourceIds`, конфликты, истекшие hold и ID заменяемых allocation |
| Бронь/hold | `transitionReservation`, `archiveReservation`, `unarchiveReservation`, `transitionHold` | Версии, разрешенные переходы и условия; подтверждение получает только уже закрепленное размещение |
| Цена | `buildQuote`, `assertQuoteCurrent`, `recognizeNights` | Приоритет ставок, ограничения, скидки, наценка и неизменяемый quote с версией; заработанная стоимость по датам ночей |
| Деньги | `parseMinor`, `serializeMinor`, `roundHalfUp`, `allocateLargestRemainder`, `createFinancialEvent`, `postLedgerEntry`, `reverseLedgerEntry`, `reverseFinancialEvent`, `financialTotals`, `paymentStatus`, `availableRefundMinor`, `assertRefundAvailable`, `depositLiabilityMinor`, `availableDepositMinor` | Целые signed int64 minor units, строки на API, двойная запись, отдельные C/P/B/R и liability залога |
| Отмена | `buildCancellationPreview`, `verifyCancellationPreview` | Версия и SHA-256 входного состояния, вычисленная политика, кредит-ноты и возвращаемая переплата; preview без побочного эффекта |

## Привязка к транзакции

`planAllocation` получает `ExistingAllocation.range` **уже с целодневными буферами**. Для `ProposedAllocation.stay` буфер задается отдельно. Сервис должен в одной транзакции: проверить membership/право/scope и `If-Match`; заблокировать перечисленные ресурсы в порядке `lockResourceIds`; деактивировать указанные истекшие hold и заменяемые allocations; перечитать актуальные пересечения; создать весь набор allocations; обновить бронь/версию и outbox. Exclusion constraint PostgreSQL окончательно отклоняет конкурентное пересечение. Ответ `ok: true` без этой транзакции не означает резервирование. `planCategoryAllocation` выбирает одну физическую единицу на весь stay и оставляет менеджеру дальнейшее явное назначение.

Новая подтвержденная внешняя бронь при конфликте сохраняется сервисом как внешний факт и incident без ложного активного allocation. Этот пакет возвращает конфликтный план, но не удаляет внешнее событие. Буфер не прибавляется к оплачиваемым ночам.

`buildQuote` требует ставки на каждую ночь и отдельный назначенный тариф категории. Выбранная ставка: день → сезон → день недели → база. Скидки длины, совместимый промокод, разрешенная ручная скидка и наценка канала распределяются по ночам методом наибольшего остатка. Сервис проверяет quote TTL и версию через `assertQuoteCurrent` до принятия, после принятия сохраняет снимок без переписывания при новых ставках. Допуслуга отдельная строка; комиссия канала не вычитается повторно из цены гостя.

`createFinancialEvent` создает сбалансированную проводку только при `succeeded`. Состояния `pending` и `failed` не изменяют C/P/R и liability. Для возврата проверяют `assertRefundAvailable` на исходном captured платеже, включая pending возвраты. Для возврата/удержания залога проверяют `availableDepositMinor`; authorization hold не является `deposit_capture`. Источник `sourceKey` и entry ID должны иметь уникальные ограничения в БД. Posted entry исправляют `reverseFinancialEvent` и новой записью, не изменением прежней.

Для отмены сервис читает финансовые версии и журнал в одной транзакции. `CancellableCharge.recognizedMinor` и `alreadyCreditedMinor` берутся из проверенного журнала, а не из запроса клиента. `buildCancellationPreview` не возвращает готовое разрешение на банковский refund; возврат — отдельная команда. `verifyCancellationPreview` проверяет hash и `If-Match` на новом снимке. Fee определяется сохраненной политикой; override доступен только при финансовом праве, причине и дополнительном подтверждении. Для досрочного выезда сервис передает к аннулированию только будущие неоказанные ночи.

Пакет не заменяет RLS, tenant scope, PostgreSQL exclusion, ledger unique constraints, настоящий hosted checkout или бухгалтерский/фискальный учет. Инварианты и критерии: [цены и ledger](../../architecture/pricing-ledger.md), [модель данных](../../architecture/data-model.md), [функциональная спецификация](../../requirements/functional-spec.md).
