# URL Shortener API

Сервіс скорочення посилань для лабораторної роботи № 6. Виконано частини 1 і 2: каркас Express.js 5 із PostgreSQL 16 через `pg-promise` у Docker та проєктування контракту OpenAPI. Бізнес-маршрути посилань ще не реалізовані — це частина 3. Наявна Swagger UI сторінка показує контракт із кореневого `openapi.yaml`.

## Запуск

Потрібні Docker Desktop із запущеним Linux Engine та Docker Compose. Для роботи з Node.js поза Docker потрібні Node.js 24+ і npm.

1. Створіть локальну конфігурацію: `Copy-Item .env.sample .env` (PowerShell) або `cp .env.sample .env` (Linux/macOS). Якщо `.env` уже є, відредагуйте його.
2. Заповніть `POSTGRES_PASSWORD` у `.env`. Інші значення можна залишити як у зразку. `.env` не додається до Git або Docker build context.
3. Виконайте `docker compose up --build -d --wait`.

Наступні запуски: `docker compose up -d --wait` або `docker compose up` для перегляду журналів у терміналі. Compose читає `.env` автоматично. `npm ci` встановлює локальні залежності з `package-lock.json`; у Docker ця команда виконується під час збирання образу.

- Swagger UI: <http://localhost:8080/docs/>
- Перевірка сервера та бази: <http://localhost:8080/health>
- PostgreSQL із комп'ютера: `127.0.0.1:5435`; ім'я бази, користувач і пароль беруться з `.env`.
- PostgreSQL із сервера в Docker: `db:5432`. Внутрішній порт не займає порт `5432` комп'ютера.

`HOST` задає адресу прослуховування Express усередині контейнера; залиште `0.0.0.0`. Опубліковані порти сервера та бази прив'язані до `127.0.0.1` комп'ютера. `PORT`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_HOST_PORT`, `POSTGRES_DB`, `POSTGRES_USER` і `POSTGRES_PASSWORD` налаштовуються через `.env`.

При локальному запуску Node.js запустіть лише базу командою `docker compose up -d db`, потім виконайте в окремому вікні PowerShell:

```powershell
npm ci
$env:POSTGRES_HOST = '127.0.0.1'
$env:POSTGRES_PORT = '5435'
npm start
```

Для повернення до Compose закрийте це вікно або видаліть лише ці тимчасові перевизначення (`Remove-Item Env:POSTGRES_HOST, Env:POSTGRES_PORT`). `.env` при цьому зберігає `POSTGRES_HOST=db`, `POSTGRES_PORT=5432`; зовнішній порт — `POSTGRES_HOST_PORT=5435`. `commander` підтримує `node main.js --help`, `--host` і `--port`; `npm run dev` автоматично перезапускає локальний сервер при зміні JS-файлів.

## Команди для знімків екрана

У PowerShell із кореня проєкту:

```powershell
docker compose ps
docker compose logs --no-color --tail 30 server db
curl.exe -i http://localhost:8080/health
docker compose exec db sh -c 'pg_isready -h 127.0.0.1 -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

У `ps` обидва контейнери повинні мати стан `Up ... (healthy)`. `/health` виконує справжній `SELECT 1` через `pg-promise` і повертає `200 {"status":"ok","database":"up"}`. Сам факт відкритого HTTP-порту не вважається готовністю сервісу.

Для знімка перевірки без бази:

```powershell
docker compose stop db
curl.exe -i http://localhost:8080/health
# Приблизно через 20 секунд health check позначить server як unhealthy.
docker compose ps -a
docker compose start db
docker compose up -d --wait
curl.exe -i http://localhost:8080/health
```

Без бази очікується HTTP `503` із `{"status":"error","database":"down"}`; після повернення бази — знову `200`. Спочатку сервер запускається лише після успішної перевірки PostgreSQL і додатково перевіряє власне підключення до початку прослуховування HTTP.

## Структура та рішення частини 1

```text
main.js                 запуск, перевірка БД, завершення процесу
src/config.js           .env і параметри commander
src/db.js               пул pg-promise та SELECT 1
src/app.js              Express, /health, Swagger UI /docs
scripts/healthcheck.js  HTTP-перевірка контейнера без curl
db/init.sql             початкова таблиця links
openapi.yaml            контракт операцій посилань, перенаправлень і /health
redocly.yaml            рекомендовані правила перевірки OpenAPI
docs/api-design.md      таблиця API та обґрунтування для звіту
docs/openapi-validation.md  результат перевірки та інструкції для скриншотів
Dockerfile              власний образ сервера на node:24-alpine
docker-compose.yml      сервер, postgres:16, перевірки, мережа та volume
.env.sample             приклад налаштувань без пароля
.gitignore              виключення .env, node_modules та журналів
.dockerignore           виключення локальних файлів із build context
package.json            залежності та npm-скрипти
package-lock.json       зафіксоване дерево залежностей
```

Назву `docker-compose.yml` обрано на вимогу користувача; це конфігурація Compose, названа `compose.yaml` у переліку матеріалів для звіту. Express запускається від непривілейованого користувача `node`. `depends_on: service_healthy` забезпечує правильний порядок запуску. Власна Docker-мережа Compose дає серверу змогу знайти базу за DNS-іменем `db`.

Таблиця `links` має первинний ключ `id` (BIGINT IDENTITY), унікальний непорожній `code`, непорожній `original_url`, `created_at` із часовим поясом та невід'ємний лічильник `clicks`, початково 0. Унікальність коду контролює база, а однакові оригінальні адреси дозволені. Формат коду, правила URL та API визначено в матеріалах частини 2; їх перевірку сервером буде реалізовано в частині 3. SQL створює порожню таблицю, без тестових посилань.

У частині 1 `openapi.yaml` описував інфраструктурний `/health`. У частині 2 до нього додано контракт CRUD і перенаправлень до їх реалізації. Swagger UI читає саме цей файл під час запуску. Встановлено `express`, `pg-promise`, `dotenv`, `commander`, `js-yaml` і `swagger-ui-express`; Swagger не дублюється в JS-коментарях. Redocly CLI є лише dev-залежністю.

Дані зберігаються в іменованому volume `postgres_data`. `docker compose down` видаляє контейнери та мережу, але зберігає volume; `docker compose down --volumes` видаляє також дані. `db/init.sql` виконується лише при першому створенні порожньої бази. Зміни SQL надалі потребують міграцій. Зміна `POSTGRES_PASSWORD` у `.env` не змінює пароль у вже створеній базі: його слід окремо змінити командою `ALTER ROLE` через psql (інтерактивно `\password url_shortener`), узгодити з `.env` і перестворити сервер через `docker compose up -d`.

## Перевірка коду та версії для звіту

```powershell
npm run check
npm ls --depth=0
node --version
npm --version
docker --version
docker compose version
docker compose exec server node --version
docker compose exec db postgres --version
git log --oneline
```

GitHub: <https://github.com/MyRuicH/URL-Shortener-API>. Коміти частин 1 і 2 створено локально без push за вказівкою користувача. Матеріали частини 2 для звіту наведено нижче; реалізація бізнес-маршрутів належить до частини 3.

Під час перевірки частини 1 24.11.2026 на Windows: локальні Node.js `24.21.0`, npm `11.19.0`, Docker Engine `29.7.2`, Compose `5.5.1`; у контейнерах Node.js `24.22.3`, PostgreSQL `16.15`; Express `5.3.0`. `npm run check` пройшов успішно, під час встановлення npm повідомив про 0 вразливостей. Обидва контейнери мали стан `healthy`, Swagger UI повертав HTTP 200; після зупинки БД `/health` повертав 503 і сервер ставав `unhealthy`, після відновлення БД — знову 200 та `healthy`. Перед частиною 2 користувач зупинив контейнер сервера.

## Частина 2 Проєктування API

[Таблиця API та обґрунтування](docs/api-design.md) містить методи, шляхи, параметри, схеми, статуси та рішення для звіту. Повний контракт — у [openapi.yaml](openapi.yaml): `/api/links`, `/api/links/{code}`, `/r/{code}`, `/health`; документація — на `/docs/`.

```powershell
npm ci
npm run lint:api
# Еквівалентна команда з методички:
npx --no-install @redocly/cli lint openapi.yaml
```

Перевірка успішна: 0 помилок, 4 обґрунтовані попередження. [Результат і покрокові інструкції для скриншотів](docs/openapi-validation.md) пояснюють кожне попередження. Лінтер не потребує запущених Docker-контейнерів. Бізнес-запити через Try it out потрібно перевіряти після частини 3; зараз Swagger показує спроєктований контракт, а сервер реалізує тільки каркас.

Для перегляду нової специфікації в наявному контейнері потрібно виконати `docker compose up --build -d --wait server`: YAML копіюється в образ під час збирання. Просто `docker compose start server` не оновить файл усередині старого образу. Після перегляду можна зупинити лише сервер командою `docker compose stop server`, залишивши базу працювати. Під час виконання частини 2 контейнер сервера не запускався.
