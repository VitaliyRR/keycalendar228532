# Каталог интеграций

Исследование: 2026-09-24. Подготовлено 75 отдельных паспортов. Контракты и условия допусков неизвестны там, где это прямо отмечено. Реализации не создавались.

[Общие обязательные правила](contract.md) · [CSV](catalog.csv) · [Структурированные данные](catalog.json) · [Матрица возможностей](capability-matrix.csv) · [Названия источников из аккаунта](source-labels.csv)

## Полнота и границы

Каталог покрывает каждую ссылку официального индекса синхронизации RC, отдельный индекс iCalendar, CRM, сторонние системы, платежи, автосообщения и найденные исторические упоминания. Исторические записи не считаются действующим паритетом до подтверждения. Видимость названия источника брони не равна активному подключению. Реестр не гарантирует обнаружение закрытых интеграций, не показанных ни в аккаунте, ни в опубликованных материалах.

Известные неоднозначности: общая фраза RC о min stay всех каналов расходится со строками Едем-в-Гости/Cbooking/Куфар/Roomook; валюта Яндекс Путешествий в экстранете RUB при общей отметке о разных валютах; направление цены Алеан требует договора. Применять более узкое подтверждённое ограничение, запрашивать разъяснение, не обещать неподтверждённую операцию.

| ID / паспорт | Сервис | Категория | Доказательство |
|---|---|---|
| [INT-101HOTELS](passports/INT-101HOTELS.md) | 101Hotels | channel | DOC |
| [INT-APARTSHARING](passports/INT-APARTSHARING.md) | Apart Sharing | channel | DOC |
| [INT-AVITO](passports/INT-AVITO.md) | Авито | channel | DOC |
| [INT-BOOKING](passports/INT-BOOKING.md) | Booking.com | channel | DOC |
| [INT-BRONEVIK](passports/INT-BRONEVIK.md) | Броневик | channel | DOC |
| [INT-CIAN](passports/INT-CIAN.md) | Циан | channel | DOC |
| [INT-EDEMVGOSTI](passports/INT-EDEMVGOSTI.md) | Едем-в-Гости.ру | channel | DOC |
| [INT-OSTROVOK](passports/INT-OSTROVOK.md) | Островок | channel | DOC |
| [INT-EMERGINGTRAVEL](passports/INT-EMERGINGTRAVEL.md) | Emerging Travel | channel | DOC |
| [INT-EXPEDIA](passports/INT-EXPEDIA.md) | Expedia | channel | DOC |
| [INT-FORENTO](passports/INT-FORENTO.md) | Forento.ru / Vkrim.info | channel | DOC |
| [INT-HOTELBOOK](passports/INT-HOTELBOOK.md) | Hotelbook | channel | DOC |
| [INT-KUFAR](passports/INT-KUFAR.md) | Kufar.by | channel | DOC |
| [INT-KVARTIRKA](passports/INT-KVARTIRKA.md) | Квартирка | channel | DOC |
| [INT-ONETWOTRIP](passports/INT-ONETWOTRIP.md) | OneTwoTrip | channel | DOC |
| [INT-OTELLO](passports/INT-OTELLO.md) | Отелло | channel | DOC |
| [INT-OZONTRAVEL](passports/INT-OZONTRAVEL.md) | Ozon Travel | channel | DOC |
| [INT-ROOMOOK](passports/INT-ROOMOOK.md) | Roomook | channel | DOC |
| [INT-SUTOCHNO](passports/INT-SUTOCHNO.md) | Суточно.ру | channel | DOC |
| [INT-TUTU](passports/INT-TUTU.md) | Туту | channel | DOC |
| [INT-ROOMLINK](passports/INT-ROOMLINK.md) | Roomlink (ранее Забронируй.ру) | channel | DOC |
| [INT-VEZDEKAKDOMA](passports/INT-VEZDEKAKDOMA.md) | Везде как дома | channel | DOC |
| [INT-GDEKVARTIRA](passports/INT-GDEKVARTIRA.md) | ГдеКвартира.су | channel | DOC |
| [INT-DOMKLIK24](passports/INT-DOMKLIK24.md) | Домклик24 | channel | DOC |
| [INT-ZHILIBYLI](passports/INT-ZHILIBYLI.md) | ЖилиБыли | channel | DOC |
| [INT-PRIVETTUR](passports/INT-PRIVETTUR.md) | ПриветТур! | channel | DOC |
| [INT-CBOOKING](passports/INT-CBOOKING.md) | Cbooking.ru | channel | DOC |
| [INT-TVIL](passports/INT-TVIL.md) | ТВИЛ | channel | DOC |
| [INT-YANDEXTRAVEL](passports/INT-YANDEXTRAVEL.md) | Яндекс Путешествия | channel | DOC |
| [INT-TRIPVENUE](passports/INT-TRIPVENUE.md) | Трипвеню | channel | DOC |
| [INT-KURORTIX](passports/INT-KURORTIX.md) | Миртурбаз / Kurortix | channel | DOC |
| [INT-ALEAN](passports/INT-ALEAN.md) | Алеан | channel | DOC |
| [INT-LIGAKVARTIR](passports/INT-LIGAKVARTIR.md) | Лига Квартир | channel | DOC |
| [INT-AIRBNB](passports/INT-AIRBNB.md) | Airbnb | channel | DOC |
| [INT-REALT](passports/INT-REALT.md) | Realt | channel | DOC |
| [INT-GOOGLECALENDAR](passports/INT-GOOGLECALENDAR.md) | Google Calendar | calendar | DOC |
| [INT-MONETA-PERSONAL](passports/INT-MONETA-PERSONAL.md) | Монета для физических лиц | payment | DOC |
| [INT-MONETA-BUSINESS](passports/INT-MONETA-BUSINESS.md) | Монета для ИП и юридических лиц | payment | DOC |
| [INT-AMOCRM](passports/INT-AMOCRM.md) | amoCRM | crm | DOC |
| [INT-BITRIX24](passports/INT-BITRIX24.md) | Битрикс24 | crm | DOC |
| [INT-OKIDOKI](passports/INT-OKIDOKI.md) | ОкиДоки | contracts | DOC |
| [INT-TTLOCK](passports/INT-TTLOCK.md) | TTLock | access | DOC |
| [INT-ROOMSHARING](passports/INT-ROOMSHARING.md) | Roomsharing Norke | access | DOC |
| [INT-WEBHOOKS](passports/INT-WEBHOOKS.md) | Исходящие webhook | developer | DOC |
| [INT-WHATSAPP](passports/INT-WHATSAPP.md) | WhatsApp в автосообщениях | messaging | DOC |
| [INT-MAX](passports/INT-MAX.md) | MAX в автосообщениях | messaging | DOC |
| [INT-TELEGRAM](passports/INT-TELEGRAM.md) | Telegram в автосообщениях | messaging | DOC |
| [INT-EMAIL](passports/INT-EMAIL.md) | Email в автосообщениях | messaging | DOC |
| [INT-SMSGATE](passports/INT-SMSGATE.md) | SMS Gate / Android SMS | messaging | DOC |
| [INT-REDATA](passports/INT-REDATA.md) | REDATA | pricing | DOC + ACCOUNT available card (ACC-INT-01) |
| [INT-YOOKASSA](passports/INT-YOOKASSA.md) | ЮKassa | payment | DOC marketing; current RC availability unknown |
| [INT-KVARTIRKA-ICAL](passports/INT-KVARTIRKA-ICAL.md) | Квартирка / kv.link (iCal) | channel | ACCOUNT (ACC-CHAN-02) + DOC generic iCal |
| [INT-QQRENTA](passports/INT-QQRENTA.md) | api.qqrenta.ru | channel | ACCOUNT label only; provider protocol unknown |
| [INT-ICAL](passports/INT-ICAL.md) | Универсальный iCalendar | calendar | DOC |
| [INT-GAMI](passports/INT-GAMI.md) | Гами (заявление внешнего поставщика) | developer | DOC provider claim; RC official listing unconfirmed |
| [INT-RENTYSOFT](passports/INT-RENTYSOFT.md) | RentySoft | access | HISTORICAL |
| [INT-FLATSHARING](passports/INT-FLATSHARING.md) | Flatsharing | access | HISTORICAL |
| [INT-KUKURENTA](passports/INT-KUKURENTA.md) | Кукурента | channel | HISTORICAL |
| [INT-NOCHLEG24](passports/INT-NOCHLEG24.md) | Nochleg24 | channel | HISTORICAL |
| [INT-LOKAL](passports/INT-LOKAL.md) | Локал | channel | HISTORICAL |

## Источники обнаружения

- [Каналы RC](https://confluence.lan.realtycalendar.ru/kb/sinhronizatsiya-s-ploshchadkami-30957164.html)
- [iCalendar](https://confluence.lan.realtycalendar.ru/kb/sinhronizatsiya-icalendar-30958453.html)
- [CRM](https://confluence.lan.realtycalendar.ru/kb/crm-sistemy-61376180.html)
- [Сторонние системы](https://confluence.lan.realtycalendar.ru/kb/storonnie-sistemy-61376194.html)
- [Платежи](https://confluence.lan.realtycalendar.ru/kb/platyonaya-sistema-61376170.html)
- [История обновлений](https://new.realtycalendar.ru/release-system-rc)

Авито и Суточно.ру являются обязательным первым этапом API-подключений; их недоступный допуск блокирует обещание рабочего API-паритета, но не проектирование и разработку общего движка. Остальные текущие интеграции входят в полный план, исторические требуют discovery gate. Все пропуски в протоколах являются внешними зависимостями, не заглушками готовых функций.

Не найдено официально поддерживаемого публичного read API RC: [FAQ исходящих webhook](https://confluence.lan.realtycalendar.ru/kb/opisanie-webhook-30958558.html) прямо говорит об отсутствии сопровождаемого внешнего партнёрского API. Для миграции нужны разрешённый экспорт/срез и согласование RC; исходящий webhook не предоставляет историческую полную выборку. Упоминания API в старых релизах и сторонних GitHub-проектах не отменяют это ограничение.

Названия `kv.link` и `api.qqrenta.ru` исследованы отдельно от native connectors: у первого в аккаунте прочитана карточка iCalendar (Квартирка); для второго протокол не установлен. Полные feed URL являются секретами и отсутствуют в комплекте.

## Кассовые субпровайдеры Монеты

Эти паспорта уточняют совместимость финансовой цепочки; наличие в списке RC не даёт Кей Календарю прямого API-доступа. Отдельную интеграцию для каждого поставщика создавать только по необходимости согласованного договора.

| Паспорт | Сервис |
|---|---|
| [INT-KOMTET](passports/INT-KOMTET.md) | Комтет |
| [INT-BUSINESSRU](passports/INT-BUSINESSRU.md) | Бизнес.ру Онлайн-Чеки |
| [INT-CLOUDKASSIR](passports/INT-CLOUDKASSIR.md) | CloudKassir |
| [INT-LIFEPAY](passports/INT-LIFEPAY.md) | Life Pay |
| [INT-ATOL](passports/INT-ATOL.md) | Атол |
| [INT-EVOTOR](passports/INT-EVOTOR.md) | Эвотор |
| [INT-FERMA](passports/INT-FERMA.md) | Ferma |
| [INT-FIRSTOFD](passports/INT-FIRSTOFD.md) | Первый ОФД |
| [INT-KITONLINE](passports/INT-KITONLINE.md) | Kit online |
| [INT-ORANGEDATA](passports/INT-ORANGEDATA.md) | Orange Data |
| [INT-SBIS](passports/INT-SBIS.md) | СБИС |
| [INT-DIGITALKASSA](passports/INT-DIGITALKASSA.md) | Digital Kassa |
| [INT-MODULKASSA](passports/INT-MODULKASSA.md) | МодульКасса |
| [INT-PLATFORMAOFD](passports/INT-PLATFORMAOFD.md) | Платформа ОФД |
| [INT-TAXCOMOFD](passports/INT-TAXCOMOFD.md) | Такском ОФД |
