# URL Shortener API

Реалізовано частини 1–3 лабораторної роботи № 6: Express.js 5, PostgreSQL 16 через pg-promise, OpenAPI 3.0.3 та Swagger UI. Сервер підтримує створення, список, метадані, зміну URL, видалення і перенаправлення з підрахунком переходів.

## Запуск

Потрібні Docker Desktop із Linux Engine та Docker Compose. Для локальних npm-команд потрібні Node.js 24+ і npm.

1. Створіть `.env`: `Copy-Item .env.sample .env` у PowerShell або `cp .env.sample .env` у Linux/macOS. Наявний `.env` не перезаписуйте.
2. Заповніть POSTGRES_PASSWORD. Пароль і `.env` не додаються до Git або Docker build context.
3. Виконайте `docker compose up --build -d --wait`. Наступні запуски — `docker compose up` або `docker compose up -d --wait`.
4. Відкрийте [Swagger UI](http://localhost:8080/docs/) і [health check](http://localhost:8080/health).

PUBLIC_BASE_URL задає основу коротких URL, типово http://localhost:8080. При зміні зовнішньої адреси/порту змініть і цей параметр. HOST=0.0.0.0 — адреса прослуховування всередині контейнера. Опубліковані порти прив'язані до 127.0.0.1 комп'ютера.

Сервер у Docker звертається до БД за db:5432; з комп'ютера PostgreSQL доступний за 127.0.0.1:5435. Імена й порти конфігуруються у `.env`; зразок — `.env.sample`. Compose запускає сервер після готовності БД. Образ працює від користувача node.

## Локальний Node.js

Запустіть лише БД через `docker compose up -d db`, звільніть порт сервера командою `docker compose stop server`, а потім в окремому PowerShell:

```powershell
npm ci
$env:POSTGRES_HOST = '127.0.0.1'
$env:POSTGRES_PORT = '5435'
npm start
```

Закрийте це вікно після роботи, щоб тимчасові змінні не впливали на Compose. CLI підтримує `node main.js --help`, `--host`, `--port`; `npm run dev` перезапускає процес при зміні JS. Для повернення до контейнерів — `docker compose up --build -d --wait`.

## Структура

```text
main.js                       Express, маршрути, валідація, Base62, HTTP-сервер
db.js                        pg-promise, транзакції та всі SQL-операції
healthcheck.js                SELECT 1, /health та HTTP-проба контейнера
src/config.js                 dotenv, commander, конфігурація
openapi.yaml                  єдине джерело контракту, версія 0.3.0
db/init.sql                  початкова таблиця links
Dockerfile                    власний образ node:24-alpine
docker-compose.yml           сервер, PostgreSQL, мережа та volume
.env.sample                   приклад конфігурації без пароля
package.json / package-lock.json  npm-залежності та команди
scripts/verify.mjs             інтеграційна перевірка локальної лабораторної
test.txt                     команди Swagger UI і позначені HTTP-доповнення
docs/part3-implementation.md  обґрунтування реалізації та змін контракту
docs/swagger-screenshots.md   кожна операція й кожний статус для скриншотів
docs/verification-results.json  результати останньої інтеграційної перевірки
```

`src/app.js`, `src/db.js` і старий скрипт healthcheck замінено кореневими файлами на вимогу користувача.

## Поведінка

Автоматичні коди — 8 випадкових символів Base62. Без alias повторний нормалізований URL повертає найстаріший наявний ресурс із 200; новий — 201. Явний alias має 4–32 символи A–Z, a–z, 0–9, `_` або `-`, зайнятий дає 409. SQL UNIQUE і транзакційне блокування захищають конкурентні створення. Невідомий URL не завантажується сервером.

GET /r/{code} атомарно збільшує clicks і повертає порожній 302 з Location; HEAD не збільшує clicks. Метадані й список не рахують переходи. PATCH змінює лише originalUrl. JSON-помилки мають єдину структуру, заголовок Cache-Control: no-store присутній також на помилках. Повний контракт і обмеження — в openapi.yaml.

Таблиця links має BIGINT IDENTITY id, унікальний непорожній code, original_url, created_at TIMESTAMPTZ та невід'ємний BIGINT clicks. BIGINT передаються в API рядками. Дані зберігаються у volume postgres_data. `docker compose down` зберігає volume; `docker compose down --volumes` видаляє дані. init.sql виконується тільки для нової порожньої БД; наявні дані частини 1 сумісні з реалізацією, міграція не потрібна. Зміна пароля в `.env` не змінює пароль уже створеної ролі PostgreSQL.

## Перевірки та звіт

```powershell
npm ci
npm run check
npm run lint:api
npm test
docker compose ps
```

`npm test` перевіряє реальний запущений сервер на localhost:8080. Він тимчасово перейменовує таблицю для 500, зупиняє БД для 503 і виконує down/up для порівняння всіх збережених рядків. Після перевірок відновлює БД та видаляє тільки власні тестові ресурси. Використовуйте його на локальній лабораторній БД. Результат — docs/verification-results.json. Образ сервера не потребує curl: `node healthcheck.js` перевіряє готовність контейнера.

24.11.2026 підтверджено 109 інтеграційних перевірок, усі статуси контракту, атомарність 20 одночасних переходів, створення одного ресурсу при 10 одночасних скороченнях однакового URL та збереження всіх рядків після down/up. Операції перевірено через Try it out у Swagger UI вбудованого браузера. Для 302, 415 та параметрів, які блокує форма Swagger, виконано додаткові HTTP-перевірки. Redocly: 0 помилок, 4 раніше обґрунтовані попередження.

- [Інструкція для скриншотів кожної операції й статусу](docs/swagger-screenshots.md)
- [Рішення частини 3 та зміни контракту](docs/part3-implementation.md)
- [Початкове проєктування частини 2](docs/api-design.md)
- [Перевірка специфікації частини 2 та пояснення попереджень](docs/openapi-validation.md)
- [GitHub-репозиторій](https://github.com/MyRuicH/URL-Shortener-API)

Згенеровані Swagger UI команди в test.txt записані як curl, без curl.exe та перевірок часу. Вони використовують формат Bash/Git Bash/WSL; для HEAD у терміналі застосовуйте curl -I. Файл містить передумови 500/503 й окремо позначені адаптовані HTTP-команди. Знімки робіть за інструкцією; рядки таблиці Responses у Swagger — опис, а фактична відповідь показана в Server response. При редиректах браузер показує кінцеву відповідь, початковий 302 видно в Network.

Версії для звіту можна отримати через `node --version`, `npm --version`, `npm ls --depth=0`, `docker --version`, `docker compose version`, `docker compose exec server node --version`, `docker compose exec db postgres --version`. Історія комітів — `git log --oneline`. Коміти створюються локально; push окремо не виконувався.
