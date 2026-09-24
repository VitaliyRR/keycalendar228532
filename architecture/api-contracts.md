# Внутренние API-контракты

[openapi.json](openapi.json) содержит основные операции и типы. Это дизайн контракта, не работающий сервер. Дополнительные операции ниже используют те же ошибки, права, версионирование и доменные сущности. До реализации конкретной операции её схема должна быть расширена в OpenAPI; текст ниже задаёт смысл и не разрешает менять обязательные поля по усмотрению разработчика.

## Общие правила

- Версия `/api/v1`; JSON UTF-8. UUID не содержит ПД; money целым числом копеек в строке; date локальная дата; timestamp RFC3339 UTC. Currency присутствует рядом с суммой.
- Tenant из `/organizations/{organizationId}` и проверенной membership. `organization_id` запрещён в create body. Webhook получает tenant по проверенному connection, а не внешнему параметру guest.
- GET не изменяет бизнес-данные. POST-команды требуют `Idempotency-Key`; ключ уникален по tenant+actor+operation. Результат и request hash хранить 7 дней; финансовую внешнюю идемпотентность хранить с Payment без короткого TTL. PATCH/DELETE/переход состояния требуют If-Match версии; создание возвращает ETag.
- Непрозрачный cursor связан с tenant, фильтрами и сортировкой. Default page 50, max 200; изменение фильтров сбрасывает cursor. Сортировка стабильна по выбранному полю+id. Пустой список 200/items=[].
- Долгая операция: 202 `{job_id,state,status_url}`; polling показывает прогресс/ошибку без raw payload. Скачивание идёт через endpoint приложения с проверкой актуального scope на каждый запрос; прямой долгоживущий storage URL пользователю не выдаётся. Отменить job можно до commit; после commit отмена означает отдельную компенсирующую операцию.
- Браузерные записи с cookie требуют CSRF; возврат от платёжной страницы не подтверждает оплату. Webhooks имеют отдельную provider authentication без пользовательской session.
- Ответы имеют correlation ID; `Cache-Control: private,no-store` для гостей, финансов и auth. Публичная доступность не раскрывает гостя/статус задолженности/внутренние заметки.

## Ошибки

| HTTP/code | Смысл | UI и повтор |
|---|---|---|
| 400 MALFORMED_REQUEST | Синтаксис/тип | Подсветить поле, не повторять автоматически |
| 401 SESSION_EXPIRED | Вход нужен | Сохранить несекретный черновик, вернуться после входа |
| 403 ACCESS_DENIED / SUBSCRIPTION_READ_ONLY | Право/тариф | Показать причину и доступный путь восстановления |
| 404 RESOURCE_NOT_FOUND | Не существует либо чужой tenant | Одинаковый ответ без раскрытия |
| 409 AVAILABILITY_CONFLICT | Даты заняты | Показать только доступные конфликтующие интервалы; предложить даты/другой объект |
| 409 IDEMPOTENCY_KEY_REUSED | Тот же key для иного body | Новый key только после проверки исходного результата |
| 409 EXTERNAL_STATE_UNKNOWN | Ответ канала/провайдера не установлен | Показать ожидание сверки; не создавать второй эффект |
| 412 VERSION_CHANGED / PREVIEW_EXPIRED | Запись изменена или истекла цена | Показать безопасный дифф, пересчитать, подтвердить заново |
| 422 BUSINESS_RULE_FAILED | Вместимость, нулевая ночь, неверный возврат | Причина и field_errors, черновик сохраняется |
| 429 RATE_LIMITED | Квота | Retry-After, отложить очередной вызов |
| 503 DEPENDENCY_UNAVAILABLE | Сервис недоступен | Показать уже сохранённые локальные данные и статус доставки |

Problem: type,title,status,code,correlation_id обязательны; detail не содержит ПД/токенов; field_errors только по собственным полям; conflicts содержит reference только если у текущей роли есть право. Переход к чужой записи по сообщению ошибки исключён.

## Контракт атомарной брони

`POST reservations`: validate auth/scope/entitlements → проверить Quote hash/expiry и вместимость → погасить истёкшие holds под блокировкой → создать reservation/stays/allocations → провести начисления, если политика требует → записать audit+outbox → commit. Сбой любого шага откатывает весь локальный эффект. Возвращается reservation с sync_state=queued; worker доставит изменения поддерживаемым каналам. Успех команды не означает успешное получение всеми каналами.

`PATCH reservations/{id}` меняет только перечисленные поля, неизвестные поля отвергаются. Перенос принимает весь новый stays[], reason и новую quote при изменении цены. Конфликт оставляет старую бронь целой. Оплаты/ledger не редактируются этим endpoint. `financial-preview` рассчитывает отмену, no-show или ранний выезд по принятой политике; `cancel` принимает preview_id/hash и версию, освобождает неиспользованные даты и записывает финансовые корректировки. Произвольный fee_minor из клиента не принимается. Refund остаётся отдельной финансовой командой. Полный контракт в [pricing-ledger](pricing-ledger.md).

`checkout` сохраняет actual_checkout_at; ранний выезд требует новой даты и financial preview, чтобы оставшаяся будущая занятость не осталась заблокирована статусом checked_out. `archive`/`restore` отделены от lifecycle: unarchive не подтверждает бронь повторно, reconfirm снова проверяет интервалы. `Deposit.authorization` также отделён от полученных денег; capture, release и return имеют разные команды и права провайдера.

## Дополнительный каталог операций

В таблице все пути без префикса подразумевают `/api/v1/organizations/{organizationId}`. `id` из URL имеет тип UUID; `version` передаётся If-Match. Структуры одноимённых сущностей в [модели](data-model.md) являются обязательным словарём полей.

| Операция | Вход | Ответ/эффект | Право, важное ограничение |
|---|---|---|---|
| POST /auth/logout | current session, CSRF | 204, revoke | Любой user, вне tenant path |
| GET /auth/sessions; DELETE /auth/sessions/{id} | user session | devices[] / 204 | Только собственные; idempotent revoke |
| POST /auth/mfa/enroll; /confirm; /disable | password/MFA, challenge | setup secret однократно / confirmed | Reauth, секрет no-store; recovery challenge отдельно |
| POST /invitations/{id}/revoke | reason, version | Invitation.state=revoked | staff.manage, последний owner не затронут |
| POST /invitations/accept | token, verified identity | Membership | Глобальный auth route, token/email match |
| GET/POST /roles; PATCH /roles/{id} | permissions[], name, version | Role | Нельзя повышать собственные полномочия |
| PATCH /organizations/{organizationId}; POST /organizations/{organizationId}/deletion-request (полные пути) | allowed settings / reason | Organization / retention job | owner+MFA; будущие обязательства блокируют удаление |
| PATCH /properties/{id}; POST /properties/{id}/archive | поля/причина,version | Property | inventory.write; активные будущие брони блокируют архив |
| PATCH /units/{id}; POST /units/{id}/archive | capacity/category/name,version | Unit | Не нарушить уже размещённых гостей |
| GET/POST /rate-plans; PATCH /rate-plans/{id} | name,policy,assignments,version | RatePlan | rates.write; изменения только будущих quote |
| GET /rates | unit_ids,from,to,rate_plan | RateDay[] | rates.read; max 93 дня |
| POST /availability-blocks/{id}/release | reason,version | allocation active=false | booking.block, освобождается только собственный block |
| GET /guests; GET/PATCH /guests/{id} | search/query / allowlisted fields,version | Guest c разрешёнными полями | scope guest по связанным разрешённым броням |
| POST /guests/{id}/merge-preview; /merge | duplicate_id, expected_versions, preview_hash | связи/конфликты / Guest | guest.merge, не merge автоматически по имени |
| POST /guests/{id}/documents/upload | purpose,type,file metadata | short upload target, doc id | guest.document.write; virus scan до чтения |
| GET /guests/{id}/documents/{docId}/download | document id | temporary application download URL | guest.document.read; audit чтения |
| POST /journal-entries/{id}/reverse | effective_date,reason,version | reversal entry | finance.correct+MFA; immutable original |
| POST /expenses | category,scope,amount,currency,date,evidence | Expense + journal | finance.write; сумма распределений=amount |
| GET/PUT /reservations/{id}/payment-schedule | policy_type,installments[date,amount],policy_version | PaymentSchedule | finance.schedule, If-Match; total=C; first_night берёт принятую цену первой ночи |
| POST /deposits/{depositId}/return | amount,reason | Deposit + связанный Refund | deposit.return; не revenue |
| POST /deposits/{depositId}/retain-preview; /retain | damages/evidence,amount,reason,preview_hash | guest adjustment + journal | deposit.retain+MFA, остаток нельзя превысить |
| GET /payment-intents/{id} | id | provider-confirmed state | scope; checkout redirect игнорируется как доказательство |
| POST /connections/{id}/activate; /disable | approved capability version,mapping hash,reason | Connection + controlled jobs | integration.manage+MFA; внешний gate обязателен |
| POST /connections/{id}/reconcile | date_range,reason | 202 job | integration.manage; API quota |
| GET /connections/{id}/deliveries | since,state,cursor | sanitized attempts | integration.read; no secrets |
| POST /deliveries/{id}/retry | reason,version | 202 job | integration.retry; unknown outcome first reconcile |
| GET /jobs/{id}; POST /jobs/{id}/cancel | id / reason | state/progress / new state | Same actor scope, re-check role |
| GET /exports/{id}/download | id | application download URL ≤10 мин с повторной проверкой роли | data.export.dataset + current scope |
| POST /imports/{id}/rollback | manifest,reason,version | 202 job | data.import+MFA; post-cutover delta handled |
| PATCH /tasks/{id} | assignee,due_at,state,version | Task | operations.manage or own allowed transition |
| POST /meter-readings | meter_id,decimal_value,unit,date,reset_reason?,evidence | MeterReading | operations.meter.write; decrease requires explicit reset |
| POST /payroll/preview; /approve | period,staff_ids,rule_version,hash | immutable preview / PayrollStatement | finance.payroll; nonduplicate cleaning reward |
| GET/PATCH /notification-preferences | channels,quiet_hours,event_flags,version | preferences | Own profile, mandatory service notices distinguished |
| POST /message-templates/preview | template,data_scope,language | escaped preview | message.manage, no send |
| POST /messages/send | template_version,recipient_ref,context,consent_basis | Notification queued | message.send; explicit action, audit, dedupe |
| POST /subscription/checkout | plan_version,period,billing_details | SaaS invoice + hosted URL | owner, no client-supplied arbitrary price |
| GET /subscription/invoices | period,cursor | SaaSInvoice[] | billing.read |
| POST /support-grants; /revoke | actor,reason,permissions,expires_at | SupportAccessGrant | owner+MFA, TTL≤1ч |

## Публичный модуль, гость и webhooks

| Путь | Контракт | Защита |
|---|---|---|
| GET /public/{slug}/availability | from,to,adults,children → public units + bookable rate summary | Нет внутренних броней/гостей; rate limit, no-store |
| POST /public/{slug}/quotes | unit,dates,occupancy → Quote | Цена рассчитывается сервером |
| POST /public/{slug}/holds | quote_id,guest_contact,legal_basis → hold_token,expires_at | Тот же allocation constraint, TTL15мин, bot/rate controls |
| POST /public/{slug}/checkout | hold_token,quote_id,payment_choice → hosted checkout | Idempotency; merchant из org, allowlisted return URL |
| GET /guest-portal/{opaqueToken} | → reservation-safe fields, tasks, balance, allowed instructions | Hash token в БД, expiry/rotation, no indexing, lock code только при выполненных условиях |
| POST /guest-portal/{token}/documents; /arrival-time; /service-requests; /cleaning-rating | Typed whitelisted values → task/document evidence | Scope ровно одной брони, file scan, без автоматического признания платежа по фото |
| POST /guest-portal/{token}/agreement/accept | document_version,challenge,response,consent evidence → signing evidence | Юридический механизм подписи подтверждается до обещания силы документа |
| POST /webhooks/{provider}/{opaqueConnectionRef} | Raw provider body+signature → 202 после durable inbox | Signature/replay rules именно провайдера; request size cap; secret не в URL |
| GET /ical/{opaqueFeedToken}.ics | availability only, UID/date/opaque summary | Возможность revoke, без имён и контактов, кэш по договорённости |

Операции support/platform отделены в `/internal/admin`, закрыты network policy и MFA. Health/readiness не возвращают список tenant или конфигурацию. API не публикуется для сторонних клиентов до отдельного scope/token/rate-limit контракта; наличие внутренних маршрутов не означает клиентский public API.
