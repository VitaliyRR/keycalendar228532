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
python tools/create_json_evidence_manifest.py --dataset booking_card_facts_ui --input <private-booking-card-facts.jsonl> --manifest <private-booking-card-facts-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset booking_pages_ui --input <private-booking-ui-pages.jsonl> --manifest <private-booking-ui-pages-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset property_edit_links_ui --input <private-property-edit-links.jsonl> --manifest <private-property-edit-links-manifest.json> --expected-rows <verified-count>
python tools/create_json_evidence_manifest.py --dataset properties_full_ui --input <private-properties-full-ui.jsonl> --manifest <private-properties-manifest.json> --expected-rows <verified-count>
```

Каждый год `payments_ui` — отдельный пакет. В JSONL физический индекс — номер строки файла; для `inventory_ui` — позиция в `objects`, для `deposits_ui` — сквозная позиция во всех `sections[].rows`. Карточки активных броней и страницы списка сохраняются отдельно от экспорта, ссылки редактирования и полные карточки объектов — отдельно от короткого списка инвентаря. Ни один UI-снимок не создаёт live объекты, брони, платежи, залоги или настройки. Снимки настроек могут содержать закрытые реквизиты, поэтому ключ шифрования и доступ к исходнику обязательны; перенос действующих интеграционных ключей не выполняется.

После первоначальных 51 карточки будущих броней пять недостающих карточек сохранены в отдельном неизменяемом пакете `active_booking_cards_ui`: `future-booking-cards-extra.jsonl` и соответствующий `future-booking-cards-extra-manifest.json`. Для него использовать тот же валидатор и загрузчик с `--expected-rows 5`, не менять первый пакет и его checksum:

```powershell
python tools/create_json_evidence_manifest.py --dataset active_booking_cards_ui --input <private-dir/future-booking-cards-extra.jsonl> --manifest <private-dir/future-booking-cards-extra-manifest.json> --expected-rows 5
```

Итого есть UI-свидетельства карточек всех 56 будущих броней. Владелец подтвердил приоритет текущих карточек RealtyCalendar для четырёх расхождений с Excel; исходные ID и решение сохранены только в закрытом наборе. Перед переносом всё ещё нужна финальная дельта. Наличие карточки и видимого статуса само по себе не создаёт бронь в KeyCalendar. На 24.09.2026 в закрытом staging рабочей БД Кей Календаря 19 пакетов / 45 802 физические строки; повторный dry-run дал ноль новых строк, а действующие объекты, брони и платежи отсутствуют.

Два дополнительных неизменяемых пакета `booking_card_facts_ui` содержат полные карточки и историю 25 представителей исторических лотов и 16 отменённых броней с метками действующих лотов. Их исходники и manifest хранятся только в приватном каталоге. Создать manifest отдельно для каждого файла, без объединения пакетов:

```powershell
python tools/create_json_evidence_manifest.py --dataset booking_card_facts_ui --input <private-dir/historical-lot-card-full.private.jsonl> --manifest <private-dir/historical-lot-card-full.private-manifest.json> --expected-rows 25
python tools/create_json_evidence_manifest.py --dataset booking_card_facts_ui --input <private-dir/monthly-lot-payment-gap-card-full.private.jsonl> --manifest <private-dir/monthly-lot-payment-gap-card-full.private-manifest.json> --expected-rows 16
```

Для каждого пакета использовать одинаковый путь файла в `--original` и `--input`; выполнить оба режима отдельно с теми же `--organization` и `--actor`:

```powershell
node apps/api/dist/import-stage0-cli.js --dataset booking_card_facts_ui --mode dry-run --organization <org-uuid> --actor <owner-user-uuid> --original <private-booking-card-facts.jsonl> --manifest <private-booking-card-facts-manifest.json> --input <private-booking-card-facts.jsonl>
node apps/api/dist/import-stage0-cli.js --dataset booking_card_facts_ui --mode stage --organization <org-uuid> --actor <owner-user-uuid> --original <private-booking-card-facts.jsonl> --manifest <private-booking-card-facts-manifest.json> --input <private-booking-card-facts.jsonl>
```

Каждая строка хранит наблюдённые статус, даты, исходный ID лота, информацию и историю карточки. Эти 41 строки подтверждают 25 разных исходных ID исторических лотов и отмену только 16 просмотренных броней; оставшиеся ID из 3 879 видимых лишь через оплаты не классифицированы этим просмотром.

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

Матрица проверяет checksum, число и физические индексы строк, отсутствие повторных ID между отдельными снимками страниц, 51 месячный исходник и точное совпадение объединённого пакета с ними. Пересечение ID между прежними страницами и месячным набором ожидаемо и считается отдельно. Текущая матрица содержит 19 пакетов / 45 802 строки, 61 открытую страницу, 51 месяц, 5 641 уникальный UI ID, 56 карточек будущих броней, 41 выборочную карточку броней и 34 карточки объектов; `complete=false`: перед живым импортом нужны финальная дельта, проверка исторических статусов и финансовых смыслов. Отдельная сверка 20 032 строк оплат выявила 9 367 ID по ссылкам; объединение с месячным набором даёт 9 520 ID, из которых 3 879 видны только в оплатах, а 153 только в месячном списке. Ещё 171 строка оплат не имеет ссылки на бронь. Эти числа описывают покрытие свидетельств, а не число подтверждённых броней или проводок. Значение `complete` не означает готовность к живому импорту; полнота финансов и вложений оценивается отдельно.

В 20 карточках раздел фотографий сохранён как `snapshot: null`, `capture_method: css_gallery_dom` и непустая `gallery`: штатный DOM-снимок раздела не открывался, а порядок и URL миниатюр получены из видимой галереи. Валидатор допускает `null` только для этой конкретной формы. Архив 578 доступных JPEG 100×100 хранится отдельно от репозитория; это не исходные изображения полного размера.

Перед загрузкой всех наборов сверить закрытую матрицу. Команда требует присутствия всех manifest, проверяет SHA-256 исходников и число/уникальность физических индексов, а результат сохраняет только рядом с исходниками:

```powershell
python tools/create_evidence_coverage.py --private-dir <private-source-directory> --output <private-source-directory/coverage-matrix.private.json>
```

Матрица хранит checksum оригинала и staging-файла, список физических индексов каждого пакета и явное состояние `complete=false` до закрытия сверки. Она подтверждает только покрытие исходных снимков, а не создание live записей или полноту доступа к RealtyCalendar.

Команда сверяет SHA-256 оригинала с манифестом и хэшем в каждой строке, проверяет физические номера и число колонок. `source_locator` вычисляется из хэша снимка, листа и номера строки; дубли номера отвергаются. Содержимое строки шифруется AES-256-GCM с привязкой к tenant, пакету, locator и row hash. В stdout выводятся только режим, UUID пакета и числа строк. Текст исходных строк, хэши клиентских файлов и ошибки PostgreSQL в журнал не выводятся.

Повтор того же набора даёт `new_rows=0`; изменение JSONL при том же оригинале отвергается. Ошибка на любой строке откатывает транзакцию целиком. Для нового снимка и delta нужен отдельный review идентичности: номер строки является ключом только внутри неизменного снимка. Импорт в рабочие таблицы запрещён до подтверждения статусов, объектов, валют, активных броней и финансовой сверки.
