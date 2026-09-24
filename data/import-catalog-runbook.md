# Каталог RealtyCalendar: подготовка Property shells

Этот путь читает уже сохранённый приватный `inventory-ui.json` и пакет evidence
этапа 0. Он не переносит номера, категории, тарифы, брони, деньги, подключения,
каналы или исходящие события. Исходный RealtyCalendar остаётся без изменений.

## Предварительные условия

- Миграции до `008_property_stay_windows.sql` применены к отдельной БД KC.
- Пакет `inventory_ui` из этого файла уже сохранён через stage-0: тот же SHA-256,
  34 строки, `staged_evidence`, 34 исходные записи без пропущенных номеров.
- Пакет `properties_full_ui` из переданных приватных карточек также сохранён:
  тот же SHA-256 и 34 строки. Четыре границы времени сверяются с ним повторно.
- Доступна runtime роль без `SUPERUSER` и `BYPASSRLS`; действующий участник
  организации имеет роль `owner` или `admin`.
- Оригинал и приватный манифест остаются вне Git, доступны только оператору
  миграции; до применения сделана проверенная резервная копия БД KC.

## Приватный манифест проверки

Путь `--manifest` должен указывать на отдельный JSON. Он содержит **все** лоты
исходного снимка. Для каждой строки указываются исходный ID и SHA-256 точного
названия, статус проверки личности лота, подтверждённые IANA timezone и четыре
границы окон заезда/выезда, ссылки на доказательства правил проживания и
подтверждения зоны.
Сами названия и ссылки не помещать в репозиторий или логи. Пример только на
синтетических данных:

```json
{
  "format": "realtycalendar-catalog-shells-v1",
  "review_status": "owner_approved",
  "organization_id": "11111111-1111-4111-8111-111111111111",
  "source_sha256": "<sha256 исходного inventory-ui.json>",
  "card_source_sha256": "<sha256 исходного properties-full-ui.jsonl>",
  "verified_by": "22222222-2222-4222-8222-222222222222",
  "verified_at": "2026-09-24T12:00:00Z",
  "expected_object_count": 1,
  "lots": [
    {
      "source_lot_id": "1001",
      "source_name_sha256": "<sha256 точного display_name>",
      "identity_verification": "verified",
      "timezone": "Europe/Moscow",
      "checkin_time": "14:00",
      "checkin_time_end": "22:00",
      "checkout_time_start": "09:00",
      "checkout_time": "12:00",
      "stay_rules_evidence_ref": "properties-full-ui.jsonl:line:1:rules:sha256:<rules-snapshot-sha256>",
      "stay_rules_snapshot_sha256": "<rules-snapshot-sha256>",
      "source_card_label_sha256": "<sha256 точного названия карточки>",
      "timezone_verification_ref": "synthetic-owner-confirmation-1001"
    }
  ]
}
```

Для неподтверждённых значений используются `null` и
`identity_verification: "pending"`. В текущем UI-снимке каталога нет IANA
timezone, поэтому часовой пояс нельзя вывести из адреса или имени; его должен
подтвердить владелец. В отдельных карточках видны времена, но для каждого лота
нужна ссылка на проверенную карточку или отдельное подтверждение владельца.
Карточка RC задаёт **окно** заезда/выезда, и целевой Property сохраняет все
четыре границы. Приватный кандидат хранит их как `observed_checkin_window` и
`observed_checkout_window`; поля применения пока `null`. Для `apply` их нужно
заполнить точными границами карточки. CLI сверит значения, ID и SHA раздела.
`expected_object_count` и список ID должны совпасть с исходным снимком.
Автоматически собранный черновик имеет
`review_status: "candidate_only_not_owner_approved"` и годится только для
предпросмотра. Перед `apply` владелец должен проверить и явно перевести
манифест в `owner_approved`.

## Предпросмотр и применение

После сборки `npm run build --workspace @keycalendar/api` задать
`IMPORT_DATABASE_URL` безопасным способом, без записи в Git и вывода в лог.
Предпросмотр без манифеста показывает число ожидающих проверку строк:

```text
node apps/api/dist/import-catalog-cli.js --inventory <private-inventory-ui.json> --organization <organization-uuid> --actor <owner-or-admin-uuid> --mode preview
```

Предпросмотр с манифестом показывает количество готовых, ожидающих, уже
сопоставленных и конфликтующих по имени объектов. Никакие бизнес-таблицы
при этом не меняются:

```text
node apps/api/dist/import-catalog-cli.js --inventory <private-inventory-ui.json> --cards <private-properties-full-ui.jsonl> --manifest <private-reviewed-manifest.json> --organization <organization-uuid> --actor <owner-or-admin-uuid> --mode preview
```

`--mode apply` требует `--cards` и допускается только после проверки **всех**
лотов и явного статуса `owner_approved`. Он создаёт
один `Property` на каждый подтверждённый source lot ID, сохраняя UUID-связь в
`catalog_property_mappings` и запись аудита в одной транзакции. Повтор того же
снимка даёт ноль новых объектов. Расхождение SHA, смена подтверждённого поля,
существующий объект с тем же названием или неполный манифест останавливают
весь пакет. Сводный вывод CLI не содержит исходных названий/ID.

До подтверждения времени и IANA timezone всех 34 лотов **не запускать apply**.
Созданный Property без Unit не продаётся; дальнейшие категории, ставки,
бронирования и подключения требуют отдельных решений и проверок.

Отдельная сверка строк оплат выявила исторические текстовые метки, отсутствующие
среди действующих 34 объектов. В просмотренных карточках 25 таких меток
соответствуют 25 разным исходным ID лотов вне действующего каталога.
Этот загрузчик создаёт только утверждённые действующие Property shells;
исторические лоты и брони требуют отдельного сопоставления и не должны
автоматически прикрепляться к одному из 34 действующих объектов по похожему
названию.

Синтетический PostgreSQL-тест на изолированной БД:

```text
node --import tsx --test apps/api/test/import-catalog.test.ts
```

Перед тестом задать `TEST_DATABASE_URL` runtime роли тестовой БД с миграциями
007 и 008.
Тест выполняет все вставки внутри транзакции с `ROLLBACK`.
