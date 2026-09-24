# Модель данных и инварианты

Это логическая спецификация, не готовая SQL-миграция. Типы: `id` UUID; `date` ISO YYYY-MM-DD; `instant` UTC timestamp; `money` int64 копейки; `bps` целые 0..10000; `version` положительное целое. API передаёт int64 money строкой, чтобы JavaScript не потерял точность. Обязательность: все перечисленные поля обязательны, кроме отмеченных `?`.

У всех tenant-сущностей: `id, organization_id, created_at, updated_at, version`; UNIQUE(organization_id,id), составные внешние ключи (organization_id,parent_id), RLS по organization_id. У append-only записей нет изменяемого updated_at/version. При архивировании добавляется archived_at?, причина и автор. Уникальность внешних ссылок ограничена подключением, а не глобальным названием канала.

## Каталог сущностей

| Сущность | Специфичные поля и связи | Ограничения |
|---|---|---|
| User | email_normalized, display_name, password_hash?, email_verified_at?, status, mfa_secret_ref? | Глобальная identity без tenant business data; email unique, только verified принимает приглашение |
| Session | user_id, token_hash, created_at, expires_at, revoked_at?, auth_level, device_label | Случайный непрозрачный токен; logout/password reset отзывают нужные сессии |
| RecoveryToken | user_id, token_hash, expires_at, used_at?, purpose | Однократный, TTL 30 мин; не хранить исходный токен |
| Organization | legal_name?, display_name, timezone, currency, lifecycle, retention_policy_id | Currency на старте RUB; смена не перекрашивает историю |
| Membership | user_id, role_id, status, permissions_version | Unique(org,user), active owner ≥ 1 |
| Role | name, permission_codes[], built_in | Изменение не может дать больше полномочий, чем у автора |
| PropertyGrant | membership_id, property_id, grant_scope | Пустой набор для ограниченной роли означает нулевой доступ |
| Invitation | email_normalized, role_id, property_ids[], token_hash, expires_at, accepted_at? | TTL 72 ч; повторная отправка отзывает старый токен, лимит сотрудников резервируется на принятии |
| Subscription | plan_version_id, status, trial_end?, paid_through?, grace_end?, merchant_ref? | Отдельно от гостевых оплат; состояние меняется по проверенному платежу/ручной подтверждённой сверке |
| PlanVersion | code, active_unit_limit?, active_member_limit?, enabled_features[], price_minor?, effective_from | Историческая версия неизменяема; пустая цена запрещает публичную продажу |
| SaaSInvoice | subscription_id, period_from, period_to, total_minor, status, payment_ref? | Unique(org,period,plan_version); повтор webhook не продлевает дважды |
| Property | name, address_private?, public_location?, timezone, checkin_time, checkin_time_end?, checkout_time_start?, checkout_time | Адрес приватен до явной публикации; только IANA timezone. `checkin_time` — начало окна заезда, `checkout_time` — конец окна выезда; NULL на дополнительных границах означает неизвестную границу, а не нулевое окно |
| UnitCategory | property_id, name, capacity_adults, capacity_children, amenities[] | Не является самостоятельной продаваемой вместимостью |
| Unit | property_id, category_id?, name, capacity, inventory_state, sort_key | Однозначная атомарная продаваемая единица; архив при будущих allocation запрещён |
| ResourceLink | sold_unit_id, occupied_unit_id | Для продажи дома целиком вместе с комнатами резервируются все атомарные ресурсы; циклы запрещены |
| RatePlan | name, currency, meal_code?, cancellation_policy_version_id, public, active | Базовый план + явные правила, не произвольный исполняемый код |
| RateAssignment | unit_id/category_id, rate_plan_id, valid_from, valid_to? | Ровно один target; приоритет unit выше category |
| RateDay | rate_plan_id, unit_id, date, amount_minor, min_stay, max_stay?, closed_to_arrival, closed_to_departure, stop_sell | Unique(org,unit,plan,date), amount≥0, min≥1, max≥min |
| PriceRule | rate_plan_id, kind, priority, condition_json, adjustment_json, valid_from, valid_to | Декларативный whitelist условий; приоритет явный; результат доступен до сохранения |
| Quote | unit_id, from, to, adults, children_ages[], currency, total_minor, expires_at, rate_version_hash | Неизменяемый снимок; итоги совпадают с суммой строк |
| QuoteLine | quote_id, date?, kind, description, quantity, unit_amount_minor, total_minor, tax_code? | Ручная скидка отдельной строкой с правом и причиной |
| Reservation | reference, primary_guest_id?, channel_connection_id?, external_booking_id?, external_booking_status?, status, source, quote_id?, currency, arrival_time?, departure_time?, actual_checkin_at?, actual_checkout_at?, cancellation_reason?, archived_at? | Public reference не даёт доступ; state machine ниже; номер уникален внутри org; архив независим от lifecycle; внешний статус не заменяет факт проживания |
| ReservationStay | reservation_id, unit_id?, category_id?, provisional_unit_id?, assignment_state, from, to, adults, children_ages[], sequence | Назначенная бронь имеет unit_id; нераспределённая category_id+provisional_unit_id; to>from; несколько stay для переселения |
| AvailabilityAllocation | unit_id, from, to, kind, reservation_stay_id?, block_id?, hold_id?, active, expires_at?, buffer_before_days, buffer_after_days | Ровно одна ссылка; no-overlap для active; effective range учитывает целодневный буфер; не удаляется при отмене, active=false |
| AvailabilityBlock | unit_id, from, to, reason_code, internal_note?, created_by | Сервисная/личная блокировка без гостя и фиктивного платежа |
| BookingHold | quote_id, expires_at, status, checkout_ref? | TTL 15 минут по умолчанию; просроченные allocation отключаются в той же транзакции, которая пытается занять диапазон |
| Guest | display_name, phone_encrypted?, email_encrypted?, phone_search_hash?, email_search_hash?, nationality_code?, retention_due_at? | Нет глобального профиля гостей всех организаций; merge только внутри org |
| ReservationGuest | reservation_id, guest_id, role, age_at_checkin? | Primary ровно один при confirmed; паспорт не обязателен для брони |
| GuestDocument | guest_id, type, encrypted_object_ref, retention_due_at, purpose, access_level | Не собирать без установленной цели; в общий поиск не индексировать |
| ConsentEvidence | guest_id?, purpose, legal_basis, text_version, obtained_at, withdrawn_at?, source_ref | Правовое основание не всегда consent; отзыв не уничтожает обязательные финансовые документы |
| LedgerAccount | code, kind, currency, property_id?, owner_id? | AR гостя, cash/bank, guest advances, deposits, revenue, expenses, AP владельцу раздельно |
| JournalEntry | business_event_type, currency, occurred_at, effective_date, source_ref, reversal_of?, posting_status | После posted неизменяема; draft не участвует в итогах; все счета строк одной валюты |
| JournalLine | entry_id, account_id, reservation_id?, property_id?, debit_minor, credit_minor | Ровно одна сторона>0; сумма дебета=кредит по каждой валюте; analytical allocation обязательна где применимо |
| Payment | reservation_id, provider_connection_id?, external_payment_id?, amount_minor, currency, direction, status, occurred_at?, allocation_kind | Unique(org,connection,external_id); success подтверждён провайдером/ручным кассовым основанием |
| PaymentIntent | reservation_id?, saas_invoice_id?, amount_minor, currency, idempotency_key, provider_ref?, state, expires_at? | Ровно одно назначение; сумма/currency после отправки не меняются |
| Deposit | reservation_id, mode, requested_minor, authorized_minor, captured_minor, returned_minor, retained_minor, released_minor, provider_connection_id?, provider_ref?, authorization_expires_at?, state | Режим authorization/manual_capture/transfer; авторизация ещё не полученные деньги и не ledger liability; допустимые операции по capability провайдера |
| ReservationCharge | reservation_id, quote_line_id?, kind, gross_minor, credit_minor, currency, recognition_date?, journal_entry_id?, policy_version | Каждая услуга/скидка/штраф учитывается ровно одной строкой; итог и признание выручки различаются |
| PaymentSchedule | reservation_id, schedule_version, policy_type, installments[], accepted_at | Политика fixed/percentage/first_night/full; сумма installments равна актуальному C; срок привязан к timezone/effective_at, изменения сохраняют историю |
| PaymentInstallment | schedule_id, sequence, due_at, amount_minor, paid_allocated_minor | Оплата распределяется по срокам FIFO с явной корректировкой; просрочка max(0,due−allocated), пока due_at<now; залог отдельным расписанием |
| Refund | payment_id, requested_minor, succeeded_minor, provider_ref?, status, reason | Суммарный успешный возврат ≤ доступного остатка; pending возврат резервирует сумму |
| FiscalReceipt | payment_id/refund_id, operation, provider_ref?, status, fiscal_fields_ref?, failure_code? | Чек отдельный автомат, не равен факту успешной оплаты |
| Expense | category_id, property_id?, reservation_id?, amount_minor, date, ledger_entry_id | Распределение общей суммы по объектам не создаёт дубли расхода |
| OwnerAgreement | owner_id, property_id, valid_from, valid_to?, formula_version, parameters | Расширение; периоды одного договора не пересекаются, историческая формула сохраняется |
| OwnerStatement | agreement_id, period, calculation_snapshot, total_minor, state, approved_by? | Расширение; повтор расчёта новая версия до утверждения |
| ChannelConnection | channel_code, account_external_ref, state, capability_version, secret_ref?, source_policy, last_success_at? | Токен только в secret store; состояние connected после согласованной проверки |
| ChannelMapping | connection_id, unit_id?/category_id?, external_listing_id, external_rate_id?, direction, enabled | Ровно один target unit/category; Unique(org,connection,external_listing,external_rate); неоднозначное сопоставление блокирует публикацию |
| ExternalEvent | connection_id, external_id, external_version?, dedupe_key, payload_ref, received_at, state | Inbox unique(org,connection,dedupe_key), raw payload зашифрован и ограничен TTL |
| OutboxMessage | topic, aggregate_id, aggregate_version, dedupe_key, payload, available_at, delivered_at? | В той же транзакции с изменением; payload обычно ID/версии без ПД |
| DeliveryAttempt | outbox_id, connection_id, request_fingerprint, attempt, status_code?, retry_at?, sanitized_error | Секреты и тела гостевых данных исключены; сходимость проверяется чтением канала |
| SyncConflict | connection_id, unit_id?, external_event_id?, local_version?, kind, state, resolution?, resolved_by? | Конфликт не исчезает после retry; хранит оба факта и выбранное действие |
| OperationTask | type, property_id, unit_id?, reservation_id?, assignee_id?, due_at, status, checklist | Для уборки минимальный гостевой контекст; будущий workflow расширяем без новой роли |
| Partner | name, contact_ref?, status, source_code, commission_policy_version? | Tenant-scoped; партнёрский контакт не даёт membership автоматически |
| PartnerReservation | partner_id, reservation_id, submitted_by?, attribution, commission_evidence? | Только собственные заявки партнёра, комиссия отдельно от платежа гостя |
| Meter | unit_id, type, measurement_unit, serial_ref?, active_from, replaced_at? | Замена создаёт новый прибор, не отрицательное потребление |
| MeterReading | meter_id, value_decimal, measured_at, evidence_ref?, correction_of?, reset_reason? | Неубывание внутри одного прибора; исправление новой записью |
| CleaningRating | task_id, reservation_id, score, comment?, submitted_at | Оценка от токена соответствующей брони, один актуальный отзыв с историей изменений |
| PayrollRule | effective_from, effective_to?, task_type, amount_minor, rating_adjustments, version | Декларативная утверждённая формула; суммы не зависят от текущей изменяемой ставки |
| PayrollStatement | worker_membership_id, period, rule_version, calculation_snapshot, amount_minor, state | Одна completed task не начисляется дважды; утверждённый расчёт неизменяем |
| AccessInstruction | unit_id, public_instruction, secret_ref?, valid_from, valid_to?, reveal_policy_version | Коды доступа в secret store, выдача гостю ограничена временем и условиями |
| Notification | recipient_user_id?, guest_id?, template_version, channel, dedupe_key, state, provider_ref? | Consent/permission/тихий период проверяются до отправки; повтор не создаёт новое уведомление |
| AuditEvent | actor_type, actor_id?, action, resource_type, resource_id, redacted_diff, correlation_id, occurred_at | Append-only; ПД diff по whitelist; чтение особо чувствительных файлов также аудитируется |
| ImportBatch | source, manifest_ref, checksum, state, schema_version, counts, validation_report_ref | Immutable snapshot, запуск apply требует approved mapping и dry-run |
| ImportRecord | batch_id, source_entity, source_id, target_entity, target_id?, source_hash, disposition, error_code? | Unique(org,batch,entity,source_id); повтор не дублирует |
| ExportJob | actor_id, filters, schema_version, state, object_ref?, expires_at, row_count?, checksum? | Фильтры и права снимка фиксируются; при скачивании полномочия проверяются повторно |
| BackgroundJob | kind, payload, tenant_context, run_at, state, attempts, lease_until?, dedupe_key | At-least-once, бизнес-эффект идемпотентен; lease не доказательство завершения |
| SupportCase | requested_by, subject, severity, redacted_context, status | Доступ к tenant только по явному временному grant |
| SupportAccessGrant | support_actor_id, organization_id, permissions[], expires_at, approved_by, reason | По умолчанию read-only, срок ≤ 1 час, каждое действие аудируется |

## Состояния бронирования

`draft → confirmed → checked_in → checked_out`; `draft/confirmed → cancelled`; `confirmed → no_show` после планового времени заезда по локальной зоне. Возврат из cancelled/no_show требует команды reconfirm с новой проверкой занятости и новой версией. draft сам по себе не занимает даты; short hold хранится отдельно. Payment и sync имеют независимые состояния, не раздувают reservation.status.

| Lifecycle/действие | Занятость | Историческая occupancy | Деньги |
|---|---|---|---|
| draft | Нет, кроме отдельного ещё действующего hold | Нет | Quote/план оплаты, без выдуманного поступления |
| confirmed | Весь утверждённый stay и буфер | Плановая загрузка; ещё не факт проживания | Начисление обязательства по договору, не немедленная заработанная выручка |
| checked_in | Весь утверждённый stay и буфер | Фактически состоявшиеся ночи отдельно от будущих | По правилам признания, [финансовый контракт](pricing-ledger.md) |
| checked_out обычный | Исторический allocation сохраняется для запрета двойных записей задним числом; будущих ночей после to нет | Завершённые ночи сохраняются | Не обнуляет долг/залог |
| checked_out досрочный | Команда явно сокращает stay.to до согласованной локальной даты выезда; остаток исходного диапазона освобождается; исходные даты в audit/quote | Только фактически согласованные ночи | Новый financial preview: возврат или штраф по принятой политике; нет скрытого списания |
| cancelled до заселения | Все неиспользованные allocations и буферы этой брони отключены в одной транзакции | 0 фактических ночей | Штраф/credit-note по preview, возврат отдельной командой |
| no_show | Неиспользованный stay отключён после явного решения; ожидание решения удерживает confirmed | 0 фактических ночей | Штраф/оплата сохраняются по политике |
| archive | Не является отменой; для confirmed требуется явная cancel_and_archive, для checked_in сначала корректный выезд | История не стирается | Платежи/проводки сохраняются |
| restore | unarchive показывает прежний статус; reconfirm отдельно проверяет свободные даты | Сохраняет историю | Не создаёт новую оплату и не восстанавливает отменённое начисление без нового preview |

Нельзя переводить checked_in в cancelled, теряя уже прожитые ночи; используется обычный/досрочный checkout. Дата досрочного выезда должна быть позже stay.from; заезд и выезд в один локальный день отражаются специальным явно утверждённым тарифом/корректировкой, поскольку основной инвентарь посуточный и не допускает нулевой диапазон. Это ограничение стартового продукта, а не отсутствие функции у ориентира.

Если OTA сообщает cancellation после фактического checked_in/checked_out, external_booking_status и исходное событие сохраняются. Локальный факт проживания не стирается: открывается status conflict с необходимой финансовой сверкой/досрочным выездом. Задержанный callback никогда не превращает checked_out в confirmed без явной команды и проверки. Для подтверждённой внешней брони с невозможным размещением локальная запись сохраняется с sync_state=conflict и без ложного активного allocation; её внешняя обязанность остаётся видимой.

Переезд: две stay в одной брони с общей суммой ночей; новая транзакция проверяет все ресурсы в детерминированном порядке, создаёт новый набор allocation и только затем заменяет старый. Нельзя сначала освободить старый объект и потерять его из-за ошибки второго шага. Продление checked_in конкурирует с новыми продажами по тем же ограничениям.

## Инварианты занятости

1. У active allocation одного tenant/unit диапазоны [from,to) не пересекаются. Проверяет PostgreSQL exclusion constraint, не Redis и не предварительный SELECT.
2. Команда с тем же idempotency key и тем же request hash возвращает прежний результат; иной hash даёт 409 IDEMPOTENCY_KEY_REUSED.
3. Изменение требует expected version; несовпадение даёт 412 VERSION_CHANGED с новым безопасным summary.
4. Истёкший hold очищается под блокировкой в транзакции продажи. Частичное условие SQL не использует now(), чтобы поведение ограничения не зависело от течения времени.
5. Два внешних подтверждения сохраняются оба как внешние факты. Второе не превращается в ложное успешное локальное размещение; открывается конфликт и возможное переселение. Система не может математически исключить одновременную продажу в двух независимых API без общего арбитра.
6. При пакетном изменении цен сначала validation preview с version hash, затем commit; политика частичного успеха явно задаётся запросом, по умолчанию atomic для локальной БД. Доставка каждому каналу отдельная.
7. Целодневный буфер задаёт effective allocation `[stay.from − before_days, stay.to + after_days)`, где значения ≥0. На одну stay/resource одна объединённая allocation, поэтому собственный буфер не конфликтует сам с собой. Количество оплаченных ночей и occupancy считают по stay, а не расширенному диапазону. Изменение/перенос/отмена заменяет диапазон атомарно. Часовые окна уборки не превращаются в оплаченные ночи; конфликт часов при раннем заезде обрабатывается задачей/правилом готовности отдельно.

## Нераспределённый номерной фонд

REQ-OBJ-005: интерфейс показывает бронь категории в очереди «Нужно назначить», но сервис уже резервирует непрерывно свободную атомарную единицу как provisional_unit_id. Обычная команда на эту единицу учитывает allocation, даже пока номер не подтверждён менеджером. В рамках одной транзакции допускается перестановка предварительных назначений среди равноценных единиц, с блокировками в стабильном порядке и повторной проверкой всех диапазонов. Если непрерывное размещение не найдено, система не обещает бронь только из суммы свободных номеров по дням. Менеджер видит варианты и может явно согласовать переселение между stay. Подтверждение назначает unit_id и снимает assignment_state=unassigned без второго списания вместимости. Это проектный алгоритм KeyCalendar; внутренняя реализация RealtyCalendar не исследована. Внешняя подтверждённая бронь сверх размещаемой вместимости всегда сохраняется как conflict, не пропадает.

## Финансовые правила

Канонический контракт в [pricing-ledger.md](pricing-ledger.md). Согласованные к оплате начисления, реальные поступления, заработанная выручка и залог являются разными показателями. Баланс гостя `B = C − P`, где C уже включает все услуги/штрафы/скидки/кредит-ноты ровно один раз, P = зачтённые успешные оплаты проживания минус успешные возвраты проживания. B>0 долг; B<0 переплата. Не прибавлять услуги повторно к C. Полученный залог хранится в liability, авторизационный hold до capture не является поступлением. Суммы примеров и тестов синтетические.

## Индексы, удаление и историчность

Календарь: (org,unit,from,to) и GiST диапазона; поиск гостя по tenant+нормализованному HMAC, не plaintext; внешняя бронь unique(org,connection,external_id); отчёты (org,effective_date,account,property); outbox доступность/lease. Глобальные UUID не заменяют tenant FK. Мягкое архивирование справочников; удаление ПД по отдельной политике с tombstone, ledger и законно необходимые доказательства сохраняются в минимальном объёме. Дневные агрегаты пересчитываются по event/version, не становятся источником истины для оплаты или занятости.
