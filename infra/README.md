# Инфраструктура Кей Календаря

Этот документ описывает отдельную службу на существующей ВМ и порядок выпуска. Он не является отчетом о готовности всех функций SaaS. Клиентские данные, пароли, URL БД, приватные ключи и feed URL не должны попадать в репозиторий или командные журналы.

## Разделение служб

| Ресурс | Кей Календарь | Соседний SkySend |
|---|---|---|
| Веб-служба | `keycalendar-saas.service`, HTTPS на порту `3000`, Node.js 24 | Apache на порту `80`; не перезапускать и не перенастраивать |
| Фоновые задачи | `keycalendar-saas-worker.service` | Службы SkySend не изменять |
| Данные | PostgreSQL 18, БД `keycalendar_saas` на `127.0.0.1:5432`, владелец `kc_owner`, рабочая роль `keycalendar_app` | MariaDB на `3306`; не подключать Кей Календарь к ней |
| Код | `/opt/keycalendar-saas/current` → каталог в `/opt/keycalendar-saas/releases/`; Node в `/opt/keycalendar-saas/node` | Файлы SkySend не использовать и не изменять |
| Секреты и TLS | `/etc/keycalendar-saas/app.env` (`root:keycalendar-saas`, `0640`); `/etc/keycalendar-saas/tls.crt` и `tls.key` | Не переиспользовать учетные данные или сертификаты SkySend |

Действующая служба слушает `0.0.0.0:3000` с отдельным сертификатом Let's Encrypt для IP. [`keycalendar-acme-renew.timer`](systemd/keycalendar-acme-renew.timer) проверяет продление дважды в день; [hook](systemd/keycalendar-cert-reload) перезапускает только службу Кей Календаря. Старый `keycalendar.service` остановлен и сохранен; при выпуске его не запускать. Файлы в [`systemd/`](systemd/keycalendar-saas.service) — образцы текущей конфигурации: перед заменой действующих unit-файлов сравнить их с ВМ и сохранить локальные параметры.

[`compose.yaml`](compose.yaml) предназначен для отдельной локальной разработки: его PostgreSQL опубликована только на `127.0.0.1:5433`. На рабочей ВМ PostgreSQL установлена отдельно; Docker Compose там не используется. Разработческий compose, тестовую БД и рабочую БД не смешивать.

## Подготовка выпуска

1. В рабочем репозитории с Node.js 24 выполнить `npm ci`, `npm run build` и тесты, затем передать архив исходного manifest/lockfile и собранных `dist` в **новый** каталог `/opt/keycalendar-saas/releases/<release-id>`. На ВМ выполнить `npm ci --omit=dev` для production зависимостей и проверить права чтения каталогов для `keycalendar-saas`. Не заменять действующий `current` до проверки. PostgreSQL-интеграционные тесты требуют отдельную мигрированную тестовую БД с `TEST_DATABASE_URL`; рабочую `keycalendar_saas` для них не использовать. Статическую проверку материалов выполнить отдельно: `python tools/verify_materials.py`.
2. Записать текущий target симлинка `current` и версии unit-файлов. Проверить, что в новом выпуске есть `apps/api/dist/server.js`, `apps/api/dist/worker.js`, `apps/web/dist/index.html` и необходимые зависимости. Не включать в архив `.env`, дампы, приватные ключи или клиентский экспорт.
3. До миграции создать отдельный снимок **только** `keycalendar_saas`. Установленный [`keycalendar-pg-backup.timer`](systemd/keycalendar-pg-backup.timer) ежедневно запускает [`keycalendar-pg-backup`](systemd/keycalendar-pg-backup), сохраняет `pg_dump -Fc` в `/var/backups/keycalendar-saas`, проверяет структуру через `pg_restore --list` и удаляет локальные файлы старше 14 дней. Перед изменением схемы запустить `systemctl start keycalendar-pg-backup.service`, проверить успешное завершение и наличие нового файла. Проверка списка архива не заменяет пробное восстановление.
4. Просмотреть SQL новых миграций и влияние на предыдущий выпуск. `npm run db:migrate` требует отдельного `DATABASE_MIGRATE_URL` с ролью владельца и, при создании/смене рабочей роли, `DATABASE_APP_PASSWORD`. Передавать их процессу миграции закрытым способом; не печатать URL/пароли и не хранить их в каталоге выпуска. Миграции применяются до переключения приложения после решения о совместимости схемы. Проверять таблицу `schema_migrations` и ошибки команды, не редактировать уже примененные миграции.
5. Проверить рабочую конфигурацию в `/etc/keycalendar-saas/app.env`: `NODE_ENV=production`, `PORT=3000`, корректные `HOST`, `DATABASE_URL` для `keycalendar_app`, HTTPS `WEB_ORIGIN`, `SESSION_COOKIE_SECURE=true`, `WEB_DIST_DIR`, пару `TLS_KEY_PATH`/`TLS_CERT_PATH` и `CSRF_SECRET`. Значения секретов не копировать в репозиторий. Сейчас `EMAIL_DELIVERY=disabled`: регистрация и восстановление по почте недоступны до настройки SMTP; это не следует считать завершенным пользовательским сценарием.

## Переключение и проверка

После успешной миграции атомарно переключить симлинк `current` на подготовленный release. Пример для оператора ВМ; заменить `NEW_RELEASE_ID` на проверенный каталог и сохранить напечатанный `previous` вне репозитория для отката:

```bash
set -e
candidate="$(realpath /opt/keycalendar-saas/releases/NEW_RELEASE_ID)"
case "$candidate" in /opt/keycalendar-saas/releases/*) ;; *) exit 1 ;; esac
test -f "$candidate/apps/api/dist/server.js"
test -f "$candidate/apps/api/dist/worker.js"
test -f "$candidate/apps/web/dist/index.html"
previous="$(readlink -f /opt/keycalendar-saas/current)"
printf 'Previous KeyCalendar release: %s\n' "$previous"
sudo ln -sfn "$candidate" /opt/keycalendar-saas/current.next
sudo mv -Tf /opt/keycalendar-saas/current.next /opt/keycalendar-saas/current
sudo systemctl restart keycalendar-saas.service keycalendar-saas-worker.service
```

Проверить `systemctl is-active` обеих служб, `https://<IP-ВМ>:3000/health/live` и `https://<IP-ВМ>:3000/health/ready`: первый маршрут проверяет процесс, второй — подключение к PostgreSQL. Затем пройти разрешенный синтетический smoke-сценарий входа/чтения своей организации и проверить логи без публикации персональных данных.

После выпуска убедиться, что Apache SkySend на `80`, MariaDB SkySend на `3306` и его пользовательский сайт отвечают как до выпуска. При проблеме Кей Календаря не останавливать и не перенастраивать SkySend, не менять его firewall, БД или файлы.

## Откат и восстановление

Если схема совместима с предыдущим кодом, вернуть симлинк `current` на записанный предыдущий release и перезапустить только две службы Кей Календаря. Пример после проверки совместимости, где `PREVIOUS_RELEASE_ID` взят из записанного до выпуска target:

```bash
set -e
previous="$(realpath /opt/keycalendar-saas/releases/PREVIOUS_RELEASE_ID)"
case "$previous" in /opt/keycalendar-saas/releases/*) ;; *) exit 1 ;; esac
test -f "$previous/apps/api/dist/server.js"
sudo ln -sfn "$previous" /opt/keycalendar-saas/current.next
sudo mv -Tf /opt/keycalendar-saas/current.next /opt/keycalendar-saas/current
sudo systemctl restart keycalendar-saas.service keycalendar-saas-worker.service
```

Повторить health и синтетический smoke, сохранить журналы инцидента. Откат кода **не** откатывает миграцию PostgreSQL и не удаляет записи, сделанные после снимка.

Если новая схема несовместима или возникло повреждение данных, остановить новые записи Кей Календаря и выбрать план восстановления отдельно. Восстановление из дампа может потерять изменения после его создания; требуется сверка новых броней, денег и внешних фактов до любого restore. Восстанавливать только выделенную БД Кей Календаря, в проверенной процедуре, с отдельным решением ответственного. Никогда не восстанавливать поверх MariaDB SkySend и не запускать старую службу Кей Календаря как обходной путь.

Первый дамп был пробно восстановлен в отдельную временную PostgreSQL-базу и прочитан, после чего временная база удалена. Ежедневные дампы сейчас находятся **на той же ВМ**. Выносная копия, шифрование/контроль доступа к ней, регулярное повторение восстановления и подтверждение RPO/RTO остаются незакрытыми задачами; локальный дамп не защитит от потери ВМ.
