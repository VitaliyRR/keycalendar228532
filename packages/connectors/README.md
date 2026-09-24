# @keycalendar/connectors

TypeScript ESM, Node.js ≥22. Runtime-зависимостей нет. Реализованы импорт/экспорт **занятости iCalendar**, безопасная загрузка HTTPS feed, чистая сверка снимков и обработчики событий через обязательные транзакционные порты хранения. Никаких обращений к аккаунту RealtyCalendar, Avito или Суточно.ру пакет не выполняет. Реальных feed, секретов и гостевых данных в тестах нет.

```powershell
npm install --prefix packages/connectors --workspaces=false --ignore-scripts
npm test --prefix packages/connectors --workspaces=false
```

В workspace: `npm run build -w @keycalendar/connectors`, `npm test -w @keycalendar/connectors`. Пакет экспортируется из `dist/src/index.js`, декларации рядом. Все экспорты перечислены в [src/index.ts](src/index.ts). `node_modules` и `dist` исключены из Git.

## Контракт для apps/api и worker

| Экспорт | Применение |
| --- | --- |
| `CONNECTOR_REGISTRY`, `getConnector`, `requireConnectorCapability` | 75 записей из проверенных паспортов; возможности реализации отделены от `referenceEvidence` RealtyCalendar. |
| `validateFeedUrl`, `resolveFeedTarget`, `fetchIcalFeed` | Проверка и загрузка секретной feed-ссылки. Из сетевой ошибки доступны только безопасный `code`, `retryable`, `retryAfterMs`. |
| `parseIcal(text, {timeZone, ownOrigin?})` | Полностью проверенный снимок либо исключение; частичный результат не возвращается. |
| `reconcileIcalSnapshot(scope, previous, snapshot, pollVersion)` | Новый сериализуемый state, upsert/remove занятости, конфликты и устаревшие события. Сам ничего не пишет в БД. |
| `serializeIcal(occupancies, {scope, origin, generatedAt})` | RFC 5545 feed с датами проживания, стабильными UID, версией и нейтральным «Занято». |
| `processInboxEvent(store, event, apply)` | Дедупликация, верификация, версия/порядок, quarantine и конфликт. `apply` получает тот же transaction handle, что receipt/cursor. |
| `dispatchOutbox(store, scope, id, adapter)` | Lease/fencing, подавление старого snapshot, сохранение попытки до сети, сверка неизвестного результата, retry/DLQ. |
| `AUTHORITY_MATRIX`, `authorizeFieldUpdate` | Владельцы полей, запрет чужой перезаписи, cutover/capability gate, защита известных контактов от пустых/маскированных значений. |

Пример последовательности внутри задачи синхронизации:

```ts
import { fetchIcalFeed, parseIcal, reconcileIcalSnapshot } from '@keycalendar/connectors';

// secretUrl извлекается из server-side encrypted secret store, никогда из логов.
const response = await fetchIcalFeed(secretUrl, { etag: savedEtag });
if (response.status === 'ok') {
  const snapshot = parseIcal(response.text, { timeZone: property.timeZone, ownOrigin });
  // Сериализация poll и транзакция по tenant+connection обязательны в apps/api.
  await db.transaction(async tx => {
    const previous = await loadLockedIcalState(tx, scope);
    const plan = reconcileIcalSnapshot(scope, previous, snapshot, durablePollVersion);
    // Проверить allocation/exclusion; чужую бронь не перезаписывать.
    // Противоречащий внешний факт сохраняется с incident.
    await persistIcalPlanAndOutbox(tx, plan);
  });
}
// 304, network error, invalid/unsupported ICS: не увеличивать missingSnapshots.
```

Имена `db/loadLockedIcalState/persistIcalPlanAndOutbox` показывают точки интеграции; это обязанности приложения, а не экспортированные фиктивные функции. Метаданные ETag/Last-Modified сохраняются только после успешного parse + commit; иначе следующий запрос должен заново получить тело. Poll version назначается долговечно до запуска, один fetch на connection одновременно. Старый или повторный pollVersion никогда не применится поверх нового. Policy исчезновения — минимум **два разных успешных полных снимка**; error/304 не считаются снимком. Период опроса задаётся конфигурацией и условиями конкретного feed, измеренный SLA не обещается.

До использования scope API проверяет membership/`integration.manage`, принадлежность property/unit/connection одному tenant и подтвержденный mapping. Feed URL хранится зашифрованно; публичный URL экспорта получает отдельный случайный отзываемый токен. Этот пакет не создаёт HTTP endpoint, токены экспорта или таблицы БД.

## Поддержанный профиль iCalendar

- Один полный `VCALENDAR VERSION:2.0`, независимые `VEVENT`. CRLF/LF, unfolding, UTF-8 folding до75 октетов, TEXT escaping. Полный документ проверяется до выдачи событий.
- `UID` и отдельный `RECURRENCE-ID` участвуют в identity вместе с tenant/connection/calendar. Точные дубли схлопываются, разные события с одной identity отклоняют снимок. `SEQUENCE` и `DTSTAMP` сохраняются. Гостевые SUMMARY/DESCRIPTION/контакты отбрасываются.
- `DTSTART/DTEND;VALUE=DATE` дают локальный диапазон `[from,to)`; диапазон поддержанных лет1900–9999. Отсутствующий DTEND у DATE означает один день. DATE-TIME принимает UTC `Z`, IANA `TZID` либо floating в явно заданной timezone объекта. Machine timezone не используется. DST gap/fold отклоняется; в таких случаях нужен однозначный UTC feed.
- DATE-TIME преобразуется в **даты проживания**, не в почасовую бронь. Событие в пределах одного местного дня отклоняется; его нельзя произвольно превратить в ночь. Интервалы с неверными датами/несогласованными типами не импортируются.
- `STATUS:CANCELLED` работает и как UID-only tombstone; `TRANSP:TRANSPARENT` освобождает ранее известную занятость после проверки версии. Отмена iCal не означает отмену коммерческой брони/платежа. Позднее освобождение проживаемой брони приложение должно направлять в incident.
- `RRULE/RDATE/EXDATE/EXRULE`, `DURATION`, `VTIMEZONE`, вложенные VALARM/VTODO и METHOD кроме PUBLISH пока **не поддержаны**. Они отвергают весь снимок. Пакет не является универсальным календарным движком или подтверждением совместимости с каждым внешним календарём. `RECURRENCE-ID` поддержан для уже развёрнутых независимых экземпляров; expansion повторений не выполняется.
- Без сравнимой версии изменение существующего события создаёт конфликт. `allowUnversionedUpdates` разрешается только для проверенного авторитетного snapshot и строго последовательного опроса; по умолчанию выключено. Старый replay не оживляет tombstone.
- Экспорт включает local/API occupancy и исключает **все** imported iCal occupancy, предотвращая циклическое повторное распространение даже при удалении стороной `X-KEYCALENDAR-ORIGIN`. Этот предел нужно явно показать в UI: автоматический обмен занятостью между двумя imported feed через реэкспорт не реализован. Остальные каналы могут закрываться через собственный поддержанный API.

Формат следует поддержанному профилю [RFC 5545, VEVENT](https://datatracker.ietf.org/doc/html/rfc5545#section-3.6.1), [эксклюзивный DTEND](https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.2.2) и [правила строк](https://datatracker.ietf.org/doc/html/rfc5545#section-3.1). Пределы выше являются осознанными ограничениями реализации.

## Сетевая защита

Только HTTPS/443, без userinfo/fragment, cookies, proxy env и произвольных заголовков. Запрещены private/loopback/link-local/multicast/documentation/transition IP, локальные имена и смешанный DNS-ответ с запрещённым адресом. Vetted DNS address передается как фактический hostname TCP/TLS-соединения, а исходный hostname сохраняется для SNI, Host и проверки сертификата. Смена DNS после проверки не меняет destination socket. Каждый redirect проходит новую проверку, conditional headers через redirect не переносятся. Используются стандартные [Node HTTPS/TLS](https://nodejs.org/docs/latest-v24.x/api/https.html).

По умолчанию: 2MB, 10000 событий, 10 секунд на всю цепочку DNS/redirect/body, максимум3 redirects; жёсткие верхние пределы fetch — 10MB/60с/5 redirects. Запрещены compressed bodies, частичные HTTP-ответы и invalid UTF-8. Ошибки не содержат URL/тела. Retry-After seconds/date сохраняется согласно [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). `resolver` может заменяться только доверенным серверным кодом; клиенту этот параметр не передаётся. Ограничения outbound egress инфраструктуры дополняют проверку библиотеки.

## Durable inbox/outbox

`InboxStore<Tx>` обязан реализовать настоящую транзакцию с блокировкой aggregate и уникальностью `(tenant,connection,eventKey)`. Receipt, cursor, внешний факт, allocation/incident и outbox пишутся в одной транзакции. Ошибка apply откатывает всё. HTTP webhook получает2xx только после долговечного входного сообщения; `verified:true` устанавливает сервер после проверки подписи/источника, а не входящий JSON. Неизвестная major schema и непроверенный источник уходят в quarantine. Для повторного запуска quarantined/reconciliation события нужна отдельная аудируемая процедура приложения; передача того же ID процессору возвращает duplicate.

`OutboxStore` сохраняет команду в транзакции доменного изменения, сериализует `(tenant,connection,entity,operation)`, выдаёт lease token и проверяет его при каждой записи. `markAttemptStarted` выполняется **до сети**. После crash/lease expiry начатая попытка возвращается с `uncertain:true`. Heartbeat/продление и fencing реализует worker; lease должен покрывать timeout, а попытки одного ресурса не должны идти параллельно. `attempts` означает число предыдущих отправок; store увеличивает счётчик атомарно при начале новой отправки.

Неизвестный результат → provider reconcile либо повтор с **договорной** поддержкой idempotency. `reconcile: not_applied` разрешен только при окончательном доказательстве, что исходная операция не выполнится позже. Без него финансовое/кодовое действие повторять нельзя. 401/403 требует переавторизации,409 — конфликта/сверки,400/422 — исправления/DLQ,429/5xx — backoff5с/30с/2м/10м/30м/2ч с jitter и Retry-After; после лимита DLQ. 5xx у неидемпотентного действия без provider idempotency также требует сверки.

Один бизнес-эффект достигается БД-ограничениями и идемпотентным провайдером. Пакет не обещает «ровно один сетевой вызов». Тестовая MemoryInbox находится только в `test/`; готового production in-memory хранилища нет. Postgres-адаптер, worker lifecycle, DLQ replay с аудитом и реальные provider contracts относятся к apps/api.

## Реестр и готовность

[registry-data.ts](src/registry-data.ts) — публичный snapshot75 паспортов от24.09.2026. `referenceEvidence.capabilities` описывает RealtyCalendar, не наш доступ. Только `INT-ICAL` и `INT-KVARTIRKA-ICAL` имеют `ical_available` для перечисленного профиля, но каждое соединение начинается `not_configured`; общий `productionReady=false` отражает отсутствие клиентского подключения/пилота. Для остальных записей актуальны `partner_access_pending`, `discovery_pending` или `fiscal_profile_pending`. В частности, Avito/Суточно не имеют исполняемого native adapter; вызов недоступной capability выдаёт `PARTNER_ACCESS_PENDING`.

Основания: [интеграционный контракт](../../integrations/contract.md), [iCal](../../integrations/passports/INT-ICAL.md), [Квартирка iCal](../../integrations/passports/INT-KVARTIRKA-ICAL.md), [Avito](../../integrations/passports/INT-AVITO.md), [Суточно](../../integrations/passports/INT-SUTOCHNO.md), [события/задания](../../architecture/events-jobs.md). Registry snapshot обновляется отдельно после проверки паспорта; изменение referenceEvidence само по себе не включает transport.

## Проверено

Тесты `node:test` проверяют UTC/IANA/floating/DST, half-open границы, UTF-8/escaping, UID и tenant isolation, collision/truncation/unsupported recurrence, два полных снимка/старый replay/отмену, транзакционный rollback/20 конкурентных дублей, source versions/gap/quarantine/conflict, outbox uncertain/retry/DLQ/authority и SSRF DNS pinning/redirect/rebinding/лимиты. HTTPS транспорт в тестах перехватывается на границе Node request; запросов к реальным каналам нет. Реальная БД, инфраструктурный egress, TLS сеть и договоры провайдеров требуют интеграционной приемки приложения.
