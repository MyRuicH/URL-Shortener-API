# Знімки екрана Swagger UI для частини 3

Нижче наведено послідовність, яка покриває кожну операцію та кожний код стану контракту. Виконуйте її на локальній лабораторній БД. Використовуйте один новий alias для серії, наприклад `screen6a`; якщо він уже зайнятий, оберіть `screen6b`. Замість `lab6missing` можна взяти будь-який валідний відсутній код.

## Підготовка

1. У терміналі з кореня проєкту виконайте `docker compose up --build -d --wait`.
2. Відкрийте http://localhost:8080/docs/ у Chrome або іншому браузері. Якщо сторінка вже відкрита, оновіть її. Заголовок має показувати 0.3.0.
3. Розгорніть потрібну операцію → Try it out → заповніть параметри/тіло → Execute.
4. Для знімка прокрутіть до **Server response**. На зображенні мають бути видимі метод/шлях або Request URL, фактичний Code, Response body та потрібні Response headers. Таблиця Responses нижче — опис контракту, а не результат запиту.
5. Для великого блоку зробіть два знімки: URL+Code+body та URL+headers. Для HEAD/204 тіла не повинно бути; для POST 200/201 покажіть Location, для всіх — Cache-Control.
6. Зберігайте знімки з назвами `post-201.png`, `get-link-404.png`, `head-redirect-500.png` тощо. Команду з блоку Curl копіюйте як `curl`, без `curl.exe` і без параметрів вимірювання часу. Багаторядковий формат із `\` призначений для Git Bash/WSL/Bash, а не Windows PowerShell.

## Звичайні операції

Спочатку створіть ресурс:

```json
{"originalUrl":"http://localhost:8080/health","alias":"screen6a"}
```

| Операція | Код | Що виконати |
| --- | --- | --- |
| POST /api/links | 201 | Наведене тіло з вільним alias |
| POST /api/links | 409 | Повторити той самий запит із тим самим alias |
| POST /api/links | 200 | Надіслати ту саму originalUrl без alias; якщо URL вже має інший найстаріший код, сервер поверне саме його |
| POST /api/links | 400 | Тіло `{"originalUrl":"ftp://example.org"}` |
| POST /api/links | 413 | Надіслати текст із `docs/oversized-body.json`, як описано нижче |
| GET /api/links | 200 | limit=20, offset=0; додатково offset=2147483647 дає порожню сторінку |
| GET /api/links | 400 | limit=`01`, offset=0; форма надсилає цей запис, сервер відхиляє початковий нуль |
| GET /api/links/{code} | 200 | code=`screen6a` |
| GET /api/links/{code} | 404 | code=`lab6missing` |
| PATCH /api/links/{code} | 200 | code=`screen6a`, тіло `{"originalUrl":"http://localhost:8080/health?updated=1"}` |
| PATCH /api/links/{code} | 400 | Валідний code, тіло `{"originalUrl":"ftp://example.org"}` |
| PATCH /api/links/{code} | 404 | code=`lab6missing`, коректне тіло URL |
| PATCH /api/links/{code} | 413 | Валідний code, велике тіло нижче |
| GET /r/{code} | 302 | code=`screen6a`; фактичний 302 дивіться в Network, пояснення нижче |
| HEAD /r/{code} | 302 | code=`screen6a`; дивіться початковий запит у Network; clicks не збільшується |
| GET /r/{code} | 404 | code=`lab6missing` |
| HEAD /r/{code} | 404 | code=`lab6missing`, без тіла |
| GET /health | 200 | Execute без параметрів |
| DELETE /api/links/{code} | 404 | code=`lab6missing` |
| DELETE /api/links/{code} | 204 | Видалити `screen6a` наприкінці всіх інших перевірок цього ресурсу |

Для додаткового знімка Base62 зробіть POST без alias з новою originalUrl, наприклад `https://example.org/screenshots/new1`. Запишіть згенерований code; повторіть той самий запит і покажіть, що 200 повертає цей код та незмінні createdAt/clicks.

Для 413 відкрийте файл `docs/oversized-body.json` в редакторі, скопіюйте весь JSON у Request body POST/PATCH, Execute. У файлі міститься справжнє тіло понад 16384 байти; 413 має пріоритет перед перевіркою довжини URL. Не копіюйте тільки його початок.

## Фактичний 302 у браузері

Swagger UI використовує браузерний fetch, який автоматично проходить редиректи. Для нашої цілі /health у Server response буде фінальний 200, хоча початкова відповідь сервера — 302. Для зовнішньої адреси замість цього може бути CORS-помилка. Це не доказ відсутності 302.

У Chrome відкрийте DevTools (F12) → Network, увімкніть Preserve log, очистіть список і натисніть Execute для GET /r/screen6a. У списку виберіть **початковий** запит `/r/screen6a`, а не наступний `/health`. У Headers покажіть Request Method GET, Status Code 302 Found, Location і Cache-Control: no-store. Зробіть знімок із Swagger UI та відкритою панеллю Network. Повторіть для HEAD; у Response тіла немає. Для перевірки лічильника зробіть GET метаданих до й після: GET-redirect додає 1, HEAD — 0.

Ту саму фактичну відповідь без проходження редиректу показують `curl -i http://localhost:8080/r/screen6a` та `curl -I http://localhost:8080/r/screen6a` у Git Bash/WSL. Для HEAD використовуйте -I: команда Swagger `curl -X HEAD` може очікувати тіло через Content-Length відповіді.

## 400 та 415, які блокує форма

Swagger UI перевіряє pattern code перед надсиланням. Якщо ввести `bad!`, форма покаже свою помилку, але HTTP-запиту не буде; старий Server response не є результатом цієї спроби. Також список Request content type містить тільки application/json, тому звичайна форма не згенерує 415.

Для цих випадків потрібне редагування вже надісланого запиту у браузерній панелі Network. У браузері з дією **Edit and Resend** (наприклад Firefox DevTools) виконайте коректний запит через Swagger UI, знайдіть його в Network, натисніть правою кнопкою → Edit and Resend. Змініть тільки зазначене нижче й надішліть. Знімок має показувати Swagger UI, змінений Request URL/headers і **фактичну відповідь повторного запиту в Network**. Блок Server response самого Swagger не оновиться для зовнішнього повтору — не позначайте його як новий результат.

| Операція | Код | Зміна в копії запиту |
| --- | --- | --- |
| GET /api/links/{code} | 400 | Додати `?other=1` до URL існуючого ресурсу |
| DELETE /api/links/{code} | 400 | Додати `?other=1`; ресурс не видалиться |
| GET /r/{code} | 400 | Додати `?other=1` |
| HEAD /r/{code} | 400 | Додати `?other=1`, метод лишити HEAD |
| POST /api/links | 415 | Змінити Content-Type на text/plain, залишити тіло JSON |
| PATCH /api/links/{code} | 415 | Аналогічно змінити Content-Type, використати існуючий code |

У Chrome можна використати встановлений клієнт, який вміє редагувати запити, або відтворити адаптовані команди з розділу додаткових HTTP-перевірок `test.txt` у Git Bash/WSL. Наявність у конкретному Chrome дії Edit and Resend не припускається. Для звіту чесно позначте ці знімки як додаткові перевірки HTTP через Network/curl; отримати всі ці випадки тільки кнопкою Execute стандартна форма не дозволяє. Якщо викладач вимагає виключно Server response Swagger для кожного статусу, це обмеження тестового інструмента варто узгодити з ним.

## Внутрішні помилки 500

Виконуйте до видалення `screen6a`. Усі запити мають бути валідні, інакше отримаєте помилку валідації замість SQL-помилки. Наведені ім'я користувача та база відповідають `.env.sample`; якщо ви їх змінювали, підставте свої.

У терміналі:

```powershell
docker compose exec -T db psql -U url_shortener -d url_shortener -v ON_ERROR_STOP=1 -c 'ALTER TABLE links RENAME TO lab6_links_backup'
```

Це тимчасово змінює назву таблиці, не видаляючи дані. Не перезапускайте сервер: `/health` перевіряє SELECT 1 і залишається 200. Через Swagger UI виконайте та зніміть **кожний** із семи запитів:

| Операція | Вхідні дані | Очікування |
| --- | --- | --- |
| POST /api/links | Новий коректний URL, без alias | 500 INTERNAL_ERROR |
| GET /api/links | limit=20, offset=0 | 500 INTERNAL_ERROR |
| GET /api/links/{code} | screen6a | 500 INTERNAL_ERROR |
| PATCH /api/links/{code} | screen6a та коректний URL | 500 INTERNAL_ERROR |
| DELETE /api/links/{code} | screen6a | 500 INTERNAL_ERROR |
| GET /r/{code} | screen6a | 500 INTERNAL_ERROR, без Location |
| HEAD /r/{code} | screen6a | 500, без тіла й Location |

Відразу відновіть таблицю, навіть якщо знімок не вдався:

```powershell
docker compose exec -T db psql -U url_shortener -d url_shortener -v ON_ERROR_STOP=1 -c 'ALTER TABLE lab6_links_backup RENAME TO links'
```

Перевірте GET метаданих — знову 200. Помилки не повинні містити SQL, пароль або stack trace.

## Недоступна база 503

Виконайте `docker compose stop db`, залишивши сервер працювати. Повторіть усі сім коректних запитів попередньої таблиці: кожен має повернути 503 SERVICE_UNAVAILABLE, HEAD — без тіла, редиректи — без Location. Окремо зробіть GET /health: 503 з `{"status":"error","database":"down"}`. Зніміть кожну операцію.

Відновіть систему командою `docker compose up -d --wait`, потім повторіть /health і GET метаданих — 200. При 503 не створюйте невалідний запит: валідація виконується до SQL і поверне відповідний 400/413/415.

## Збереження даних і завершення

1. Створіть ще два посилання з іншими alias. Зробіть кілька GET /r для одного з них. Збережіть знімки GET метаданих усіх трьох ресурсів з code, originalUrl, createdAt і clicks.
2. У терміналі виконайте `docker compose down`, а потім `docker compose up -d --wait`. Не додавайте --volumes.
3. Оновіть /docs/, повторіть GET списку й метаданих усіх трьох ресурсів. Зніміть незмінні поля й лічильники. GET метаданих не рахує переходи.
4. Тепер зробіть DELETE screen6a → 204, повторіть → 404. Видалення збережених ресурсів до перевірки зіпсує порівняння.
5. Додатково для загального контракту: PUT /api/links через HTTP дає 405 з Allow: GET, POST; невідомий шлях дає JSON 404.

Повний набір автоматичних перевірок: `npm test`. Він тимчасово зупиняє БД, перейменовує таблицю та перестворює контейнери, відновлюючи їх після перевірок. Результати зберігаються у `docs/verification-results.json`.
