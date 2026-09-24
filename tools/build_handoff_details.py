"""Build screen contracts and UI copy from public handoff inputs. No app code."""
from pathlib import Path
import json
from build_design import FORM_CONTENT, TABLE_CONTENT

ROOT=Path(__file__).resolve().parents[1]
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8-sig'))
def unique(values):return list(dict.fromkeys(values))

COPY='''
COMMON.SAVE|action|Сохранить
COMMON.CANCEL|action|Отмена
COMMON.CLOSE|action|Закрыть
COMMON.RETRY|action|Повторить
COMMON.BACK|action|Назад
COMMON.NEXT|action|Продолжить
COMMON.FILTER_RESET|action|Сбросить фильтры
COMMON.EXPORT|action|Экспортировать выбранный период
COMMON.SAVING|status|Сохранение…
COMMON.SAVED|status|Изменения сохранены.
COMMON.LOADING|status|Загружаем данные…
COMMON.EMPTY|empty|Пока нет записей.
COMMON.EMPTY_FILTER|empty|По выбранным фильтрам ничего не найдено.
COMMON.NETWORK|error|Не удалось загрузить данные. Проверьте соединение и повторите запрос.
COMMON.OFFLINE|warning|Нет соединения. Показана сохранённая занятость, изменение недоступно.
COMMON.STALE|warning|Данные обновлялись {time}. Перед изменением проверим их ещё раз.
COMMON.FORBIDDEN|error|Для этого действия недостаточно прав. Обратитесь к администратору организации.
COMMON.NOT_FOUND|error|Запись недоступна или удалена.
COMMON.DIRTY_TITLE|dialog|Закрыть без сохранения?
COMMON.DIRTY_BODY|dialog|Внесённые изменения будут потеряны.
COMMON.KEEP_EDITING|action|Продолжить редактирование
COMMON.DISCARD|action|Закрыть без сохранения
COMMON.VERSION|error|Запись уже изменена. Сравните текущие данные со своим черновиком.
COMMON.COMPARE|action|Сравнить версии
COMMON.RATE_LIMIT|error|Слишком много запросов. Повторите через {duration}.
COMMON.REQUIRED|field_error|Заполните поле «{label}».
COMMON.INVALID_DATE|field_error|Такой даты нет. Укажите дату в формате ДД.ММ.ГГГГ.
COMMON.INVALID_MONEY|field_error|Введите сумму больше нуля с точностью до копеек.
COMMON.REQUEST_ID|help|Код обращения: {support_code}.
CAL.TODAY|action|Сегодня
CAL.NEW|action|Новое бронирование
CAL.RANGE|status|{checkin}–{checkout} · {nights}
CAL.AVAILABLE|status|Даты свободны
CAL.UNASSIGNED|status|Номер не выбран, квота категории занята.
CAL.CONTINUES|help|Проживание продолжается за пределами видимого периода.
CAL.BUFFER|help|Время подготовки. Не входит в оплаченные ночи.
CAL.CONFLICT|error|Даты уже заняты. Выберите другой объект или измените период.
CAL.FIND_ALTERNATIVE|action|Подобрать объект
CAL.MOVE_PREVIEW|dialog|Проверьте новые даты, объект и стоимость перед переносом.
RES.REQUEST|status|Заявка
RES.REQUEST_HELP|help|Заявка не блокирует даты.
RES.HOLD|status|Даты удерживаются до {time}.
RES.CONFIRMED|status|Подтверждена
RES.CHECKED_IN|status|Проживает
RES.CHECKED_OUT|status|Выехал
RES.NO_SHOW|status|Не заехал
RES.CANCELLED|status|Отменена
RES.ARCHIVED|status|В архиве
RES.DATE_ORDER|field_error|Выезд должен быть позже заезда.
RES.CAPACITY|field_error|Для этого объекта превышено число гостей. Измените состав или выберите другой объект.
RES.CHILD_AGE|field_error|Укажите возраст каждого ребёнка на дату заезда.
RES.CREATE_REQUEST|action|Сохранить заявку
RES.CONFIRM|action|Подтвердить бронь
RES.CHANGE|action|Изменить проживание
RES.CANCEL_TITLE|dialog|Отменить бронирование?
RES.CANCEL_BODY|dialog|Проверьте новый расчёт. Даты освободятся после подтверждения. Возврат оплаты оформляется отдельно.
RES.RESTORE|dialog|Восстановить бронь? Проверим доступность и пересчитаем условия.
RES.UNARCHIVE|help|Возврат из архива не меняет состояние бронирования.
RES.OTA_CANCEL|warning|Отмена ожидает подтверждения канала.
RES.CHECKOUT_EARLY|dialog|Проверьте фактическую дату выезда, начисления и возможный возврат.
RATE.QUOTE_EXPIRED|warning|Расчёт устарел. Обновите стоимость перед подтверждением.
RATE.QUOTE_UPDATED|dialog|Стоимость изменилась с {old_amount} на {new_amount}. Проверьте состав цены.
RATE.RESTRICTION|error|Для выбранных дат требуется не менее {min_nights}. Измените период.
RATE.STOP_SELL|error|Продажи на выбранные даты закрыты.
RATE.MIN_MAX|field_error|Минимальное проживание не может превышать максимальное.
RATE.PREVIEW|action|Показать изменения
RATE.BULK_CONFIRM|dialog|Будут изменены цены для {units} на {nights}. Подтверждённые брони сохранят стоимость.
RATE.UNSUPPORTED|warning|Этот канал не поддерживает выбранное ограничение. Оно не будет отправлено.
OBJ.ARCHIVE_BLOCK|error|У объекта есть будущие бронирования. Сначала решите вопрос с размещением.
OBJ.TIMEZONE|help|Даты проживания и время уведомлений рассчитываются по часовому поясу объекта.
OBJ.PHOTOS|help|Загрузите фотографии объекта, на использование которых у вас есть права.
GST.DUPLICATE|warning|Найдены похожие контакты. Совпадение телефона не доказывает, что это один человек.
GST.MERGE|dialog|Проверьте профили и связанные бронирования перед объединением.
GST.DOCUMENT_PRIVATE|help|Документ доступен только сотрудникам с соответствующим правом. Просмотр фиксируется в истории.
GST.FILE_SCAN|status|Проверяем файл. Просмотр станет доступен после завершения проверки.
GST.FILE_REJECTED|error|Файл не принят. Проверьте формат и выберите другой файл.
GST.CONSENT|help|Согласие на предложения по email необязательно для бронирования.
GST.PORTAL_EXPIRED|error|Срок действия ссылки истёк. Запросите новую ссылку для своей брони.
FIN.UNPAID|status|Не оплачено
FIN.PARTIAL|status|Частично оплачено
FIN.PAID|status|Оплачено
FIN.OVERPAID|status|Переплата {amount}
FIN.NO_CHARGE|status|Оплата не требуется
FIN.DEBT|label|К доплате
FIN.REFUND|action|Оформить возврат
FIN.REFUND_CONFIRM|dialog|Вернуть {amount} по исходному способу оплаты?
FIN.REFUND_PENDING|status|Возврат выполняется.
FIN.REFUND_UNKNOWN|warning|Проверяем результат возврата. Не повторяйте операцию до завершения сверки.
FIN.REFUND_TOO_LARGE|field_error|Сумма превышает доступный остаток с учётом уже созданных возвратов.
FIN.PAYMENT_UNKNOWN|warning|Платёж ещё не подтверждён. Обновим состояние после ответа провайдера.
FIN.LATE_PAYMENT|warning|Оплата поступила после окончания удержания дат. Менеджер проверит размещение.
FIN.MANUAL_EVIDENCE|help|Подтвердите фактическое получение денег. Изображение перевода само по себе не меняет баланс.
FIN.REVERSAL|dialog|Исправление создаст сторно и новую операцию. Исходная запись останется в истории.
FIN.DEPOSIT|label|Возвратный залог
FIN.DEPOSIT_HELD|status|Средства заблокированы, но ещё не получены.
FIN.DEPOSIT_RELEASE|action|Снять блокировку залога
FIN.DEPOSIT_RETURN|action|Вернуть полученный залог
FIN.DEPOSIT_RETAIN|field_error|Укажите основание и подтверждение удержания.
FIN.RECEIPT_PENDING|status|Чек формируется.
FIN.RECEIPT_FAILED|error|Чек не сформирован. Откройте причину и порядок исправления.
INT.ACCESS_REQUIRED|warning|Для подключения нужен допуск поставщика.
INT.MAPPING_REQUIRED|error|Сопоставьте объект и тариф перед запуском обмена.
INT.UNSUPPORTED|warning|Операция недоступна для этого способа подключения.
INT.ICAL|help|iCal передаёт календарные события. Цены, платежи и полные данные гостя не синхронизируются.
INT.LOCAL_SAVED|status|Сохранено в Кей Календаре. Доставка в канал ожидается.
INT.STALE|warning|Канал не подтвердил обновление с {time}. Проверьте журнал обмена.
INT.CONFLICT|error|Внешняя бронь пересекается с размещением. Назначьте ответственного и согласуйте решение.
INT.NO_DELETE|help|Входящее событие сохранено. Решение по конфликту будет записано отдельно.
INT.SECRET|help|Секрет сохранён. Прочитать его обратно нельзя; можно заменить.
INT.RETRY|action|Повторить разрешённую попытку
MIG.DRY_RUN|help|Проверка создаёт отчёт и не меняет рабочую организацию.
MIG.STATUS_MISSING|error|В исходных строках нет статуса. Активная занятость не определена.
MIG.ID_MISSING|error|Нет устойчивого ID бронирования. Автоматическое объединение запрещено.
MIG.CURRENCY_MISSING|error|Для суммы не указана валюта. Требуется подтверждение источника.
MIG.PAYMENTS_MISSING|warning|История платежей не предоставлена. Сумма брони не является оплатой.
MIG.BLOCKED|warning|Переключение недоступно, пока не закрыты расхождения.
MIG.APPROVE|action|Подтвердить протокол сверки
IAM.RECOVERY_SENT|status|Если для этого адреса есть аккаунт, мы отправим инструкцию по восстановлению.
IAM.LOGIN_FAILED|error|Не удалось войти. Проверьте данные и повторите попытку.
IAM.EMAIL_PENDING|warning|Подтвердите рабочую почту, чтобы продолжить.
IAM.INVITE_EXPIRED|error|Приглашение истекло. Обратитесь к администратору за новым.
IAM.MFA_INVALID|field_error|Код не подошёл. Введите текущий код из приложения.
IAM.BACKUP_CODE|help|Резервный код используется один раз.
IAM.LAST_OWNER|error|Сначала назначьте другого владельца организации.
IAM.REVOKED|warning|Доступ к организации прекращён.
ORG.SWITCH_DIRTY|dialog|Перед переходом в другую организацию сохраните или закройте текущий черновик.
ORG.EMPTY|empty|Добавьте первый объект или начните с импорта.
BILL.LIMIT|error|Достигнут лимит плана. Измените план, чтобы добавить ещё один объект.
BILL.GRACE|warning|Оплата подписки просрочена. Льготный период действует до {date}.
BILL.READ_ONLY|warning|Подписка ограничена. Просмотр и экспорт данных доступны.
BILL.PAYMENT_PENDING|status|Проверяем оплату подписки.
BILL.RENEW_CONSENT|label|Разрешаю автопродление на условиях выбранного плана.
MSG.PREVIEW|action|Предпросмотр сообщения
MSG.CONFIRM_SEND|dialog|Отправить сообщение выбранному получателю по каналу {channel}?
MSG.SENT|status|Передано провайдеру.
MSG.DELIVERED|status|Доставка подтверждена.
MSG.UNKNOWN|warning|Результат отправки неизвестен. Перед повтором требуется проверка.
MSG.FAILED|error|Сообщение не доставлено. Откройте журнал попыток.
MSG.UNSUBSCRIBED|warning|Получатель отказался от этой категории сообщений.
OPS.CLEANING_DONE|action|Передать уборку на проверку
OPS.REWORK|field_error|Укажите пункты, которые нужно исправить.
OPS.SUPPORT_SCOPE|dialog|Разрешить поддержку для указанной цели, операций и срока?
OPS.SUPPORT_ENDED|status|Временный доступ поддержки завершён.
REP.DEFINITIONS|help|Определения показателей и параметры периода входят в экспорт.
REP.EXPORT_READY|status|Отчёт готов. Скачать файл можно до {time}.
EMAIL.BOOKING_SUBJECT|template|Подтверждение бронирования {booking_number}
EMAIL.BOOKING_BODY|template|Здравствуйте, {guest_name}. Ваше бронирование подтверждено: {property_name}, {checkin}–{checkout}. Стоимость {total}, оплачено {paid}, к доплате {balance}. Условия и документы: {secure_booking_link}.
EMAIL.INVITE_SUBJECT|template|Приглашение в {organization_name}
EMAIL.INVITE_BODY|template|Вас приглашают в рабочее пространство {organization_name}. Проверьте роль и объекты после входа. Принять приглашение: {invite_link}. Ссылка действует до {expires_at}.
EMAIL.RECOVERY_SUBJECT|template|Восстановление доступа в Кей Календарь
EMAIL.RECOVERY_BODY|template|Для восстановления доступа откройте {recovery_link}. Ссылка действует 30 минут. Если вы не запрашивали восстановление, ничего делать не нужно.
PUSH.EVENT|template|В рабочем пространстве появилось событие. Откройте Кей Календарь.
'''

EXTRA_FIELDS={
'calendar':['Период','Объекты','Статусы','Источник','Вид/плотность','Время последнего обновления'],
'calfilters':['Город','Удобства','Комнаты','Гости','Свободно от/до','Тип','Источник','Статус','Плотность'],
'conflict':['Запрошенные даты','Конфликтующие разрешённые записи','Альтернативные объекты/даты'],
'reservation-new':['Объект/категория','Источник','Заезд/выезд','Взрослые','Дети и возраст','Главный гость','Контакт','Тариф','Услуги','Заметка','Действие: заявка/подтвердить'],
'reservation':['Статус проживания','Проживание и состав','Принятый quote','Начислено','Зачтено оплаты','Баланс','Залог','История','Состояние доставки'],
'cancel':['Причина','Принятая политика','Начисления до/после','Штраф','Баланс','Доступный возврат','Версия расчёта'],
'allocation':['Категория','Нераспределённые брони','Занятая квота','Подходящие единицы','План перестановки'],
'map':['Период','Гости','Метки объектов','Список альтернативный карте'],
'selection':['Критерии поиска','Включённые объекты','Цена','Срок ссылки','Разрешённые действия получателя'],
'public':['Объект','Даты','Состав','Имя','Телефон','Email','Принятые правила','Отдельное необязательное marketing consent','Quote','Hold expiry','Оплата'],
'guest-portal':['Проверенная сессия гостя','Своя бронь','Адрес','Принятые правила','Оплата/залог','Документы','Связь'],
'guest':['Контакты','Связанные брони','Дубли','Документы','Основания/согласия'],
'documents':['Документ','Цель','Правовое основание','Версия','Проверка файла','Срок хранения','История доступа'],
'contract':['Версия шаблона','Стороны','Проживание','Цена/условия','Провайдер подписи','Состояние','Файл/история'],
'rates':['Объекты','Дни недели','База','Скидка длительности','Даты действия'],
'massrates':['Объекты','Диапазон','Дни недели','Правило изменения','Предпросмотр до/после','Число ночей','Подтверждение'],
'restrictions':['Объекты/тариф','Диапазон','Min/max stay','Запрет заезда/выезда','Stop-sell','Поддержка канала'],
'channels':['Сервис','Механизм','Допуск','Capabilities','Сопоставления','Последняя попытка/успех','Ошибки'],
'sync-conflicts':['Исходные события','Версии','Поля сторон','Ресурс/даты','Ответственный','Решение','Результат сверки'],
'import':['Файл/тип/контрольная сумма','Область данных','Поля источника','Сопоставления','Предпросмотр строк'],
'reconcile':['Строка','Проверка','Расхождение','Решение','Счётчики до/после','Подпись проверяющего'],
'cutover':['Чек-лист gates','Ответственные','Заморозка записи','Каналы','Протокол','Rollback','Подтверждение'],
'access':['Сотрудник','Роль','Объекты','Исключения операций','Срок приглашения','Предпросмотр прав','Отзыв'],
'auth':['Email','Пароль','Регистрация','Подтверждение email','MFA challenge','Безопасный return route'],
'recovery':['Email','Одноразовая ссылка','Новый пароль','MFA/резервный код','Истечение'],
'onboarding':['Организация','Часовой пояс','Валюта','Способ начала','Объекты','Команда','Каналы'],
'subscription':['План/версия','Период','Использованные лимиты','Цена из прайса','Trial/grace','Дата ограничения'],
'expired':['Срок ограничения','Доступные просмотр/экспорт','Восстановление оплаты','Состояние входящих каналов'],
'billing-invoices':['Счёт','Период','План','Итог по версии','Статус','Чек/счёт'],
'operations':['Метрика','Измерение/время','Порог','Состояние','Инцидент','Протокол восстановления'],
'notifications':['Событие','Время','Разрешённый контекст','Прочитано','Действие'],
'chat':['Диалог','Канал','Получатель','Текст','Вложения','Предпросмотр','Capabilities отправки','Состояние доставки'],
'report':['Период','Объекты','Группировка','Начисления/выручка','Расходы','Загрузка','ADR','Расшифровка'],
'report-channels':['Период','Источник','Брони','Отмены','Комиссии','Gross/net','Фильтры'],
'report-module':['Период','Посещения','Начали бронь','Оплатили','Конверсия','Определение события'],
'metrics':['Метрика','Формула','Знаменатель','Что включено/исключено','Версия','Экспорт'],
}

def build():
    reqs=read('requirements/reference.json')['features']+read('requirements/saas.json')['requirements'];byid={r['id']:r for r in reqs}
    design=read('design/screens.json');contracts=[]
    for s in design['screens']:
        related=[byid[r] for r in s['requirement_ids']];kind=s['kind']
        fields=EXTRA_FIELDS.get(kind,[]);primary=None
        if kind in FORM_CONTENT:
            heading,controls,primary,note=FORM_CONTENT[kind];fields=[c[0] for c in controls]
        elif kind in TABLE_CONTENT:fields=TABLE_CONTENT[kind][0]
        fields=fields or unique(v for r in related for v in r.get('inputs',[]))
        variants=[v['id'] for v in design.get('variants',[]) if v['parent_screen']==s['id']]
        domain=s['id'].split('-')[1]
        public=kind in ['public','guest-portal'];auth=kind in ['auth','recovery']
        contracts.append({
          'screen_id':s['id'],'title':s['title'],'layout':kind,'surface':'guest' if public else 'auth' if auth else 'organization',
          'requirement_ids':s['requirement_ids'],'roles':unique(v for r in related for v in r.get('roles',[])),
          'entry':'Проверенная ограниченная ссылка собственной брони' if kind=='guest-portal' else 'Публичная страница объекта/подборки' if public else 'Вход/одноразовая ссылка' if auth else 'Пункт раздела '+domain+', поиск или глубокая ссылка доступной записи',
          'controls_or_columns':fields,'inputs':unique(v for r in related for v in r.get('inputs',[])),
          'actions':unique(([primary] if primary else [])+[v for r in related for v in r.get('actions',[])]),
          'result':unique(v for r in related for v in r.get('outcomes',[])),
          'business_rules':unique(v for r in related for v in r.get('rules',[])),
          'states':unique(['loading','empty','filter_empty','read_error','forbidden','offline_readonly']+[v for r in related for v in r.get('states',[])]),
          'specific_errors':unique(v for r in related for v in r.get('errors',[])),
          'edge_cases':unique(v for r in related for v in r.get('edges',[])),
          'validation_flow':['Проверить право на действие и объект','Показать ошибки у полей с сохранением введённых данных','Если действие меняет цену/период/деньги, показать свежий расчёт и последствия','Подтверждать эффект только после известного результата; timeout ведёт к проверке состояния'],
          'focus':['При открытии полной страницы фокус на заголовок','Ошибка формы переводит на первую ошибку','Закрытие диалога возвращает фокус к исходному действию'],
          'responsive':'Список дня/опциональная прокручиваемая сетка' if domain=='CAL' else 'Одна колонка на mobile; строки таблицы раскрываются, ключевые суммы не скрываются',
          'shared_behavior':'specification.md','editable_svg':s['source'],'preview_png':s['preview'],'state_artboards':s['state_refs'],'variants':variants,
          'acceptance':unique(v for r in related for v in r.get('acceptance',[])),
          'task_ids':unique(r['task_id'] for r in related),'test_ids':unique(r['test_id'] for r in related),
          'supporting_only':not bool(related)
        })
    result={'version':'1.0','as_of':'2026-09-24','scope':'Static screen behavior contracts. Not implemented or tested application. All samples synthetic.','screens':contracts}
    (ROOT/'design/screen-specs.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    messages=[]
    import re
    for line in COPY.strip().splitlines():
        key,context,value=line.split('|',2);messages.append({'id':key,'context':context,'text':value,'placeholders':re.findall(r'\{(\w+)\}',value)})
    copy={'locale':'ru-RU','version':'1.0','messages':messages,'format_rules':{
      'dates':'ДД.ММ.ГГГГ в поле; 24–27 сентября в компактном чтении; год обязателен вне текущего года; часовой пояс объекта рядом со спорным временем',
      'money':'Целые minor units → локальное отображение 12 600 ₽; копейки показывать при ненулевой дроби; отрицательный баланс подписать Переплата, не скрывать',
      'plural':'Russian one: n%10=1 и n%100!=11; few:2..4 кроме12..14; many:0,5..9,11..14; other:дробные. night=ночь/ночи/ночей; object=объект/объекта/объектов.',
      'placeholders':'Экранировать как текст; URL только созданные системой и разрешённые по назначению. Шаблон не выполняет выражения.',
      'privacy':'В уведомлении ОС/почтовой теме нет паспорта, кода замка, суммы долга или полного контакта. Данные письма только необходимому проверенному получателю.',
      'errors':'Код внутреннего исключения не показывать. support_code случайный идентификатор обращения без ПД.',
      'source':'Собственные тексты проекта. Юридические условия в них не подменяют согласованные документы.'}}
    (ROOT/'design/copy.json').write_text(json.dumps(copy,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    index=['# Контракты экранов','', 'Подробные поля, действия, правила, ошибки и приёмка каждого экрана находятся в [screen-specs.json](screen-specs.json). Общие состояния/клавиатура/адаптивность — [specification.md](specification.md). Копирайт — [copy.json](copy.json).','', '| Экран | Поля/колонки | Предметные варианты |','|---|---|---|']
    for s in contracts:index.append('| '+s['screen_id']+' · '+s['title']+' | '+'; '.join(s['controls_or_columns'])+' | '+(', '.join(s['variants']) or 'Общие состояния + правила экрана')+' |')
    (ROOT/'design/screen-specs.md').write_text('\n'.join(index)+'\n',encoding='utf-8')
    print(f'Built {len(contracts)} screen contracts and {len(messages)} literal UI messages.')

if __name__=='__main__':build()
