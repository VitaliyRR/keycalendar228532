# События, задания и доставка интеграций

Все схемы декларативны. Нет реализованного обработчика и нет активного подключения. Схемы версионируются независимо от названий внешних API.

## Общий конверт

`event_id UUID, type string, schema_version integer, organization_id UUID, aggregate_type, aggregate_id UUID, aggregate_version integer, occurred_at UTC, correlation_id UUID, causation_id?, actor {type,id?}, data object`.

Payload содержит идентификаторы и необходимые безопасные значения, не полный Guest. Неизвестная major schema уходит в quarantine, а не молча теряет поля. Consumers совместимы с добавлением необязательных полей. Секреты никогда не передаются в событиях. Audit отличается от event: первое доказательство действия, второе рабочее сообщение.

| Событие | data | Подписчики | Идемпотентный ключ |
|---|---|---|---|
| reservation.confirmed.v1 | reservation_id, stay_ids, unit_ids, date_ranges, quote_id | availability publish, notification, turnover plan | event_id+consumer |
| reservation.stay_changed.v1 | reservation_id, old/new unit/date, version | availability old+new ranges, report dirty dates, tasks | reservation_id+version+consumer |
| reservation.lifecycle_changed.v1 | reservation_id, old_status,new_status,actual_checkin_at?,actual_checkout_at?,version | Операционные задачи, гостевая страница, отчёты; изменение дат отдельным stay_changed | reservation_id+version+consumer |
| reservation.cancelled.v1 | reservation_id, released_ranges, reason_code, refund_required | availability, refund review, notifications | reservation_id+version |
| allocation.changed.v1 | unit_id, from,to, inventory_version | channel availability snapshot | connection+unit+inventory_version |
| rate.changed.v1 | rate_plan_id, unit_ids, from,to, rate_version | supported channel rate pushes | connection+rate_version |
| payment.succeeded.v1 | payment_id, reservation_id?/invoice_id?, amount_minor,currency | ledger, reservation balance, fiscal receipt | payment_id+provider_final_version |
| refund.succeeded.v1 | refund_id,payment_id,amount_minor | ledger, receipt | refund_id |
| deposit.authorization_changed.v1 | deposit_id,state,authorized_minor,captured_minor,released_minor,expires_at? | Интерфейс залога и напоминания об expiry; ledger только при captured | deposit_id+provider_final_version |
| subscription.entitlement_changed.v1 | subscription_id,previous,current,effective_at | product policy cache, banners | subscription_id+version |
| task.completed.v1 | task_id,completed_by,completed_at | readiness, payroll draft, notification | task_id+version |
| integration.conflict_opened.v1 | conflict_id,kind,connection_id,severity | manager inbox, alert | conflict_id |
| import.completed.v1 | batch_id,manifest_hash,counts,report_id | review notice only | batch_id |
| tenant.deletion_scheduled.v1 | organization_id,execute_after,policy_version | retention worker | org+policy_version |

## Каталог фоновых заданий

| Job | Запуск/период | Payload | Повторы и итог | Ограничение |
|---|---|---|---|---|
| JOB-001 outbox.dispatch | Непрерывно, lease 60 с | outbox_id | 5 с,30 с,2 мин,10 мин,30 мин,2 ч с jitter; затем DLQ | Сохранять порядок aggregate_version; устаревший snapshot не посылать |
| JOB-002 channel.pull | По договору канала, default не включён | connection_id,cursor | 429 Retry-After; auth 401 → reconnect_required; circuit breaker | Частоту включать только по паспорту и квоте |
| JOB-003 channel.reconcile | Полная сверка ежедневно либо разрешённое окно | connection_id,date_range | Прогресс по pages, checkpoint | Не переписывать конфликт автоматически |
| JOB-004 hold.expire | Каждые 30 с + проверка при продаже | hold_id или scan cursor | Идемпотентное освобождение активного allocation | Просрочка worker не даёт ложную гарантию свободного места |
| JOB-005 payment.reconcile | Pending через 1/5/15/60 мин, затем manual | payment_intent_id | Проверить status API при неопределённом timeout | Не создавать второй payment intent при unknown result |
| JOB-006 receipt.reconcile | После payment/refund и retry | receipt_id | По правилам оператора фискализации | Ошибка чека не меняет успешную оплату на failed |
| JOB-007 report.build | Запрос пользователя, dirty days | report_id,filters_hash,as_of | Retry вычисления, не отправки дважды | Снимок фильтров и scope, экспорт не более заданного лимита |
| JOB-008 notification.send | После события, с quiet hours | notification_id | Проверить consent/status до каждой фактической отправки | Повтор после неизвестного результата требует provider lookup/dedupe |
| JOB-009 import.validate | Файл и mapping утверждены | batch_id,mode=dry_run | Restart с checkpoint; всегда без внешних выходов | staging, egress deny, запрет отправки уведомлений |
| JOB-010 import.apply | Только после gate MIG-APPROVED | batch_id,manifest_hash | Upsert по source map; rollback batch | Никогда не запускать во время исследования |
| JOB-011 backup.verify | Ежедневно manifest, ежемесячно restore | snapshot_id,target_environment | Incident при просрочке/неполноте | Отдельный RF account; restore без egress |
| JOB-012 retention.enforce | Ежедневно | policy_version,cutoff | Dry-run отчёт → утверждённая политика → apply | Legal hold исключает документы; audit удаления без ПД |
| JOB-013 subscription.tick | Каждые 15 мин | subscription_id | State transition compare-and-swap | Входящие внешние брони/платежи обрабатываются даже read-only |
| JOB-014 task.schedule | После reservation и ежедневная сверка | reservation_id,rule_version | Dedupe по reservation+task type+stay version | Отмена/переезд корректирует будущую задачу и сохраняет историю |
| JOB-015 health.alert | Каждую минуту | metric rule+window | Grouping/suppression до смены состояния | В alert нет токенов/гостей |

Очередь at-least-once. Lease захватывается транзакционно, heartbeat продлевает; остановка после внешнего запроса до отметки completed считается неопределённым результатом. Повтор обязан проверить внешний idempotency key или статус. «Ровно один вызов» не обещается; «один бизнес-эффект» доказывается контрактными тестами.

## Источник истины и конфликты

| Поле/факт | Владелец | Обработка несовпадения |
|---|---|---|
| Внешний номер, подтверждение/отмена, commission из канала | Канал | Верифицированное событие сохраняется; древняя версия не отменяет новую |
| Локальная занятость всех источников | KeyCalendar после миграции | База проверяет allocation; внешняя коллизия → incident, не потерянная бронь |
| Базовые цены/ограничения | KeyCalendar только для mapped writable capability | Preview диффа; изменения на канале вызывают drift и решение администратора |
| Гостевой контакт | Первоисточник + ручное исправление с provenance | Не заменять ручной контакт пустым/маскированным полем канала |
| Оплата | Провайдер/кассовое подтверждение | Одно provider payment → одна проводка; сумма сверяется |
| Комментарий менеджера, теги, назначения | KeyCalendar | Внешнее событие не перезаписывает |
| iCal UID/занятый диапазон | Источник iCal | Только импорт block; исчезновение требует двух успешных снимков, не сетевой ошибки |

При событии без sequence/version использовать provider updated_at и повторный GET authoritative state, если доступен. Время приёма webhook не доказывает свежесть. Незнакомый объект → unmapped, внешняя бронь сохраняется в inbox и видна в очереди. Retry не должен создавать новую локальную бронь. Отсутствие записи в одном неполном poll не означает отмену.

Внешняя отмена после фактического заселения обновляет external_booking_status и открывает conflict; состоявшиеся ночи/проводки не удаляются. Внешний commercial status и локальный lifecycle различаются. Разрешение конфликта вызывает подходящую доменную команду, а не прямой UPDATE статуса в обход правил.

## Защита подключения

Webhook: проверка подписи по официальному алгоритму, timestamp/replay window если предусмотрены; размер тела, content type, rate limit; 2xx только после долговечной записи в inbox. Если подпись отсутствует по контракту, применять документированный способ аутентификации и проверить фактический объект через API до изменения. iCal fetch: HTTPS, запрет private/link-local/loopback IP после DNS и redirect, ограничение redirect/размера/времени, URL без токена в логах. XML parsers без external entities, файлы без макросов, CSV formula escaping.

Replay из DLQ показывает причину, target, expected effect и права; пользователь подтверждает конкретный повтор, после чего создаётся аудит. Это функция будущего продукта; в исследуемом аккаунте её не запускать.
