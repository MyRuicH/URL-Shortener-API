# URL Shortener API

Каркас сервісу скорочення посилань для лабораторної роботи № 6. Виконано частину 1: Express.js 5 підключається до PostgreSQL 16 через `pg-promise`, обидва сервіси запускаються в Docker. Операції з посиланнями будуть спроєктовані в частині 2 до їх реалізації в частині 3.

## Запуск

Потрібні Docker Desktop із запущеним Linux Engine та Docker Compose. Для роботи з Node.js поза Docker потрібні Node.js 24+ і npm.

1. Створіть локальну конфігурацію: `Copy-Item .env.sample .env` (PowerShell) або `cp .env.sample .env` (Linux/macOS). Якщо `.env` уже є, відредагуйте його.
2. Заповніть `POSTGRES_PASSWORD` у `.env`. Інші значення можна залишити як у зразку. `.env` не додається до Git або Docker build context.
3. Виконайте `docker compose up --build -d --wait`.

Наступні запуски: `docker compose up -d --wait` або `docker compose up` для перегляду журналів у терміналі. Compose читає `.env` автоматично. `npm ci` встановлює локальні залежності з `package-lock.json`; у Docker ця команда виконується під час збирання образу.

- Swagger UI: <http://localhost:8080/docs/>
- Перевірка сервера та бази: <http://localhost:8080/health>
- PostgreSQL із комп'ютера: `127.0.0.1:5433`; ім'я бази, користувач і пароль беруться з `.env`.
- PostgreSQL із сервера в Docker: `db:5432`. Внутрішній порт не займає порт `5432` комп'ютера.

`HOST` задає адресу прослуховування Express усередині контейнера; залиште `0.0.0.0`. Опубліковані порти сервера та бази прив'язані до `127.0.0.1` комп'ютера. `PORT`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_HOST_PORT`, `POSTGRES_DB`, `POSTGRES_USER` і `POSTGRES_PASSWORD` налаштовуються через `.env`.

При локальному запуску Node.js змініть `POSTGRES_HOST=127.0.0.1` і `POSTGRES_PORT=5433`, запустіть лише базу командою `docker compose up -d db`, потім `npm start`. Для подальшого запуску всього проєкту в Docker поверніть `POSTGRES_HOST=db`, `POSTGRES_PORT=5432`. `commander` підтримує `node main.js --help`, `--host` і `--port`; `npm run dev` автоматично перезапускає локальний сервер при зміні JS-файлів.

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
openapi.yaml            контракт /health; операції посилань — у частині 2
Dockerfile              власний образ сервера на node:24-alpine
docker-compose.yml      сервер, postgres:16, перевірки, мережа та volume
.env.sample             приклад налаштувань без пароля
.gitignore              виключення .env, node_modules та журналів
.dockerignore           виключення локальних файлів із build context
package.json            залежності та npm-скрипти
package-lock.json       зафіксоване дерево залежностей
```

Назву `docker-compose.yml` обрано на вимогу користувача; це конфігурація Compose, названа `compose.yaml` у переліку матеріалів для звіту. Express запускається від непривілейованого користувача `node`. `depends_on: service_healthy` забезпечує правильний порядок запуску. Власна Docker-мережа Compose дає серверу змогу знайти базу за DNS-іменем `db`.

Таблиця `links` має первинний ключ `id` (BIGINT IDENTITY), унікальний непорожній `code`, непорожній `original_url`, `created_at` із часовим поясом та невід'ємний лічильник `clicks`, початково 0. Унікальність коду контролює база, а однакові оригінальні адреси поки дозволені. Остаточний формат коду, правила URL та API визначатимуться в частині 2. SQL створює порожню таблицю, без тестових посилань.

`openapi.yaml` уже описує інфраструктурний `/health` перед його реалізацією; Swagger UI читає саме цей файл під час запуску. Контракт CRUD і перенаправлень ще не створено. Встановлено `express`, `pg-promise`, `dotenv`, `commander`, `js-yaml` і `swagger-ui-express`; Swagger не дублюється в JS-коментарях.

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

GitHub: <https://github.com/MyRuicH/URL-Shortener-API>. Коміт частини 1 створюється локально без push за вказівкою користувача. Звіт, повна специфікація та реалізація сервісу належать до наступних етапів.

Перевірено 24.11.2026 на Windows: локальні Node.js `24.21.0`, npm `11.19.0`, Docker Engine `29.7.2`, Compose `5.5.1`; у контейнерах Node.js `24.22.3`, PostgreSQL `16.15`; Express `5.3.0`. `npm run check` успішний, під час встановлення npm повідомив про 0 вразливостей. Обидва контейнери мають стан `healthy`, Swagger UI повертає HTTP 200; після зупинки БД `/health` повертає 503 і сервер стає `unhealthy`, після відновлення БД — знову 200 та `healthy`.
