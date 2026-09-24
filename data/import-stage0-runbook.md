# Закрытая загрузка исходных снимков RealtyCalendar

Этот загрузчик сохраняет только свидетельства этапа 0. Он не создаёт объекты, гостей, брони, allocations, начисления, платежи, проводки, сообщения или подключения. Состояние `staged_evidence` и число строк в интерфейсе не означают перенос активной базы. Дальнейшие решения и сверка описаны в [спецификации миграции](migration-spec.md).

## Вход и права

- Оригинальные XLS/XLSX и UI-снимки JSON/JSONL вместе с приватными manifest/JSONL находятся вне Git в закрытом каталоге владельца. Команда запускается там, где доступны эти файлы. Не копировать их в артефакты CI или логи.
- `IMPORT_DATABASE_URL` указывает на выбранную PostgreSQL и runtime роль `keycalendar_app` без `SUPERUSER`/`BYPASSRLS`. Для репетиции использовать только изолированную тестовую БД. `--organization` и `--actor` — UUID организации KeyCalendar и действующего owner/admin этой организации. Загрузчик проверяет membership под tenant RLS.
- Для записи установить `IMPORT_STAGING_KEY_HEX`: случайный 32-байтовый ключ в виде 64 hex-символов, сохранённый отдельно от БД и репозитория. Без этого ключа закрытые строки нельзя будет расшифровать. Dry-run ключа не требует.
- В БД сначала применить миграцию `006_import_evidence.sql`. Она создаёт `import_records` с tenant RLS, FK к пакету и неизменяемым зашифрованным JSON каждой исходной строки.

## Запуск

Сначала выполнить dry-run. Все пути ниже — placeholders; использовать реальные пути только в закрытой локальной команде:

```powershell
node apps/api/dist/import-stage0-cli.js --dataset bookings --mode dry-run --organization <org-uuid> --actor <owner-user-uuid> --original <private-bookings.xls> --manifest <private-manifest.json> --input <private-bookings-staging.jsonl> --worksheet source-sheet-1
```

Затем, после проверки выбранной БД/организации и отчёта, загрузить свидетельства:

```powershell
node apps/api/dist/import-stage0-cli.js --dataset bookings --mode stage --organization <org-uuid> --actor <owner-user-uuid> --original <private-bookings.xls> --manifest <private-manifest.json> --input <private-bookings-staging.jsonl> --worksheet source-sheet-1
```

Исходный манифест `bookings.xls` не содержит имени листа. У оригинала проверен один лист; `source-sheet-1` — устойчивый технический locator для этого снимка. Для нескольких листов нужен точный идентификатор каждого листа и отдельный JSONL, иначе одинаковые номера физических строк неоднозначны.

Для XLSX наборов сначала сформировать приватные JSONL и manifest без слияния одинаковых строк:

```powershell
<bundled-python> tools/extract_xlsx_evidence.py --dataset clients --input <private-clients.xlsx> --output <private-clients-evidence.jsonl> --manifest <private-clients-evidence-manifest.json> --expected-rows <verified-count> --expected-columns 4
<bundled-python> tools/extract_xlsx_evidence.py --dataset expenses --input <private-expenses.xlsx> --output <private-expenses-evidence.jsonl> --manifest <private-expenses-evidence-manifest.json> --expected-rows <verified-count> --expected-columns 6
```

Парсер читает XLSX без вычисления формул и отключает внешние ссылки. Оригинальные файлы остаются неизменными. Каждая физическая строка после заголовка становится отдельной записью; повторяющиеся клиенты и расходы не объединяются. Приватные выходные файлы создаются рядом с оригиналами и при повторе принимаются только байт-в-байт теми же.

Затем выполнить те же команды загрузчика с `--dataset clients` или `--dataset expenses` и соответствующими `--original`, `--manifest`, `--input`. Для XLSX имя единственного листа берётся из сгенерированного manifest автоматически. У каждого dataset отдельный `import_batches` и отдельный source checksum. Ни один из них не создаёт live гостей или расходов.

Для исходных UI-снимков создать manifest в том же закрытом каталоге. Их оригинал одновременно служит входом (`--original` и `--input` указывают на один файл):

```powershell
python tools/create_json_evidence_manifest.py --dataset payments_ui --year <year> --input <private-payments-year.jsonl> --manifest <private-payments-year-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset inventory_ui --input <private-inventory-ui.json> --manifest <private-inventory-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset deposits_ui --input <private-deposits-ui.json> --manifest <private-deposits-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset settings_ui --input <private-settings-ui.jsonl> --manifest <private-settings-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset active_booking_cards_ui --input <private-active-booking-cards.jsonl> --manifest <private-active-booking-cards-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset booking_pages_ui --input <private-booking-ui-pages.jsonl> --manifest <private-booking-ui-pages-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset property_edit_links_ui --input <private-property-edit-links.jsonl> --manifest <private-property-edit-links-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset properties_full_ui --input <private-properties-full-ui.jsonl> --manifest <private-properties-manifest.json> --expected-rows <verified-count>
```

Каждый год `payments_ui` — отдельный пакет. В JSONL физический индекс — номер строки файла; для `inventory_ui` — позиция в `objects`, для `deposits_ui` — сквозная позиция во всех `sections[].rows`. Карточки активных броней и страницы списка сохраняются отдельно от экспорта, ссылки редактирования и полные карточки объектов — отдельно от короткого списка инвентаря. Ни один UI-снимок не создаёт live объекты, брони, платежи, залоги или настройки. Снимки настроек могут содержать закрытые реквизиты, поэтому ключ шифрования и доступ к исходнику обязательны; перенос действующих интеграционных ключей не выполняется.

После первоначальных 51 карточки будущих броней пять недостающих карточек сохранены в отдельном неизменяемом пакете `active_booking_cards_ui`: `future-booking-cards-extra.jsonl` и соответствующий `future-booking-cards-extra-manifest.json`. Для него использовать тот же валидатор и загрузчик с `--expected-rows 5`, не менять первый пакет и его checksum:

```powershell
python tools/create_json_evidence_manifest.py --dataset active_booking_cards_ui --input <private-dir/future-booking-cards-extra.jsonl> --manifest <private-dir/future-booking-cards-extra-manifest.json> --expected-rows 5
```

Итого есть UI-свидетельства карточек всех 56 будущих броней, но наличие карточки и видимого статуса не разрешает четыре расхождения с Excel и не создаёт бронь в KeyCalendar. На 24.09.2026 в закрытом staging рабочей БД Кей Календаря 17 пакетов / 45 761 физическая строка; повторный dry-run дал ноль новых строк, а действующие объекты, брони и платежи отсутствуют.

После создания manifest вызвать загрузчик для каждого снимка сначала с `--mode dry-run`, затем с `--mode stage`. Указать его `--dataset`, `--original`, `--manifest`, `--input`, `--organization` и `--actor`. Один и тот же неизменный снимок при повторе даёт `new_rows=0`.

Дополнительные снимки страниц реестра сохраняются отдельно под именами `booking-ui-page-NNN.jsonl` и `booking-ui-page-NNN-manifest.json`. Исходный снимок первых страниц не перезаписывать: его SHA-256 уже входит в пакет загрузки. Для каждого нового файла использовать `--dataset booking_pages_ui` и оригинал, совпадающий с JSONL.

Когда общая пагинация не открывает следующие страницы, месячные фильтры позволяют сохранить отдельные снимки `booking-ui-month-YYYY-MM.jsonl`. Для периода январь 2023 — март 2027 имеются 51 исходный файл. Перед загрузкой проверить их и собрать **отдельный** неизменяемый приватный пакет:

```powershell
python tools/package_monthly_booking_evidence.py --private-dir <private-dir> --first-month 2023-01 --last-month 2027-03 --output <private-dir/booking-ui-months-combined.jsonl> --manifest <private-dir/booking-ui-months-combined-manifest.json> --qa <private-dir/booking-ui-months-combined-qa.json>
```

Сборщик проверяет непрерывную последовательность месяцев, полный диапазон дат фильтра, заезд в соответствующем месяце, выезд после заезда, девять строковых ячеек, последовательность страниц и индексов, а также отсутствие повторных ID в месячном наборе. Исходные строки не изменяются; повтор создаёт те же байты и сверяет уже созданные выходы. Manifest создаётся и проверяется штатным `create_json_evidence_manifest.py`; QA содержит только приватные контрольные суммы и агрегаты. Для stage0 использовать `--dataset booking_pages_ui`, а `--original` и `--input` направить на один `booking-ui-months-combined.jsonl`. Нельзя конкатенировать этот пакет с прежними страницами в один batch: 1 525 ID прежних страниц намеренно повторяются в месячной выборке, где всего 5 641 уникальный ID.

Закрытую матрицу покрытия пересчитать с наблюдаемым числом страниц и лотов:

```powershell
python tools/create_evidence_coverage.py --private-dir <private-dir> --output <private-matrix.json> --allow-missing-properties --expected-booking-pages 226 --expected-properties 34
```

Матрица проверяет checksum, число и физические индексы строк, отсутствие повторных ID между отдельными снимками страниц, 51 месячный исходник и точное совпадение объединённого пакета с ними. Пересечение ID между прежними страницами и месячным набором ожидаемо и считается отдельно. Текущая матрица содержит 17 пакетов / 45 761 строку, 61 открытую страницу, 51 месяц, 5 641 уникальный UI ID, 56 карточек будущих броней, 34 карточки объектов и `complete=false`: расхождение с 5 640 строками Excel и статусы броней ещё требуют сверки. Значение `complete` не означает готовность к живому импорту; полнота финансов и вложений оценивается отдельно.

В 20 карточках раздел фотографий сохранён как `snapshot: null`, `capture_method: css_gallery_dom` и непустая `gallery`: штатный DOM-снимок раздела не открывался, а порядок и URL миниатюр получены из видимой галереи. Валидатор допускает `null` только для этой конкретной формы. Архив 578 доступных JPEG 100×100 хранится отдельно от репозитория; это не исходные изображения полного размера.

Перед загрузкой всех наборов сверить закрытую матрицу. Команда требует присутствия всех manifest, проверяет SHA-256 исходников и число/уникальность физических индексов, а результат сохраняет только рядом с исходниками:

```powershell
python tools/create_evidence_coverage.py --private-dir <private-source-directory> --output <private-source-directory/coverage-matrix.private.json>
```

Матрица хранит checksum оригинала и staging-файла, список физических индексов каждого пакета и явное состояние `complete=false` до закрытия сверки. Она подтверждает только покрытие исходных снимков, а не создание live записей или полноту доступа к RealtyCalendar.

Команда сверяет SHA-256 оригинала с манифестом и хэшем в каждой строке, проверяет физические номера и число колонок. `source_locator` вычисляется из хэша снимка, листа и номера строки; дубли номера отвергаются. Содержимое строки шифруется AES-256-GCM с привязкой к tenant, пакету, locator и row hash. В stdout выводятся только режим, UUID пакета и числа строк. Текст исходных строк, хэши клиентских файлов и ошибки PostgreSQL в журнал не выводятся.

Повтор того же набора даёт `new_rows=0`; изменение JSONL при том же оригинале отвергается. Ошибка на любой строке откатывает транзакцию целиком. Для нового снимка и delta нужен отдельный review идентичности: номер строки является ключом только внутри неизменного снимка. Импорт в рабочие таблицы запрещён до подтверждения статусов, объектов, валют, активных броней и финансовой сверки.
