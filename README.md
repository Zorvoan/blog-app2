# Blogík – blogový systém s administrací

Webové administrační rozhraní pro správu blogu ve stylu **Twitter / Reddit**.
Stránky se renderují **na serveru (SSR)**, data jsou v **lokální SQLite databázi**
a aplikace **funguje i offline**.

## Spuštění

Potřebujete Node.js **18.18 nebo novější** (verzi zjistíte příkazem `node -v`).

- Na Node.js **22.13+** se použije vestavěný modul `node:sqlite` – bez dalších závislostí.
- Na starším Node.js (18, 20) se automaticky použije balíček `better-sqlite3`, který
  `npm install` nainstaluje jako volitelnou závislost (předkompilovaný i pro Windows).
- Pokud se `better-sqlite3` nepodaří nainstalovat (např. firemní proxy blokuje stažení),
  nainstalujte Node.js 22 LTS z https://nodejs.org.

```bash
npm install
npm run seed     # nepovinné: ukázková data (admin / admin12345, jana / jana12345)
npm start        # http://127.0.0.1:3000
```

Pokud začnete bez ukázkových dat, **první registrovaný uživatel se stane administrátorem**.

Proměnné prostředí:

| Proměnná        | Výchozí hodnota   | Popis                                            |
|-----------------|-------------------|--------------------------------------------------|
| `PORT`          | `3000`            | port serveru                                     |
| `HOST`          | `127.0.0.1`       | adresa, na které server naslouchá                |
| `DB_FILE`       | `data/blog.db`    | cesta k souboru SQLite databáze                  |
| `COOKIE_SECURE` | –                 | `1` = cookie jen přes HTTPS (za reverzní proxy)  |
| `SQLITE_DRIVER` | automaticky       | vynucení ovladače: `node` nebo `better-sqlite3`  |

Testy: `npm test`

## Funkce

**Přihlášení, registrace a nastavení**
- registrace / přihlášení / odhlášení, hesla hashovaná přes `scrypt`, relace v databázi
- ochrana CSRF u všech formulářů, omezení opakovaných neúspěšných přihlášení
- nastavení profilu (jméno, e-mail, bio), změna hesla (odhlásí ostatní zařízení),
  motiv (světlý / tmavý / podle systému), smazání účtu
- administrátor navíc: název a popis webu, počet příspěvků na stránku, zapnutí/vypnutí registrace,
  správa rolí uživatelů

**Role**

| | Běžný uživatel | Administrátor |
|---|---|---|
| psát příspěvky a komentáře, hlasovat | ✔ | ✔ |
| upravovat / mazat **své** příspěvky a komentáře | ✔ | ✔ |
| upravovat / mazat **cizí** příspěvky | ✘ | ✘ |
| mazat **cizí** komentáře (moderace) | ✘ | ✔ |
| stránky, rubriky, štítky | ✘ | ✔ |
| uživatelé a nastavení webu | ✘ | ✔ |

**Příspěvky** – vytváří se jako **text** (žádné nahrávání souborů, žádná knihovna médií)
- rychlé psaní přímo z hlavní stránky (jako tweet) i rozšířený editor
- formátování: `**tučně**`, `*kurzíva*`, `` `kód` ``, odkazy, nadpisy, seznamy, citace,
  bloky kódu, `#štítky` a `@zmínky` – veškeré HTML od uživatele je escapováno
- stavy publikováno / koncept, připnutí (admin), koš s obnovou, trvalé smazání
- hromadné akce (publikovat, koncept, přesun do rubriky, koš, obnovení, smazání)
- filtrování, vyhledávání, řazení, stránkování
- hlasování nahoru/dolů (Reddit), karma, komentáře
- příspěvek smí **upravit a smazat pouze jeho autor** – ani administrátor nemůže měnit cizí příspěvky
  Každá změna se ukládá do **historie revizí** (kdo, kdy, popis změny) a libovolnou verzi lze obnovit.

**Stránky** – vytvoření, úprava, smazání, vlastní adresa (slug), koncept, zobrazení v navigaci,
pořadí, historie revizí s obnovou.

**Kategorizace**
- rubriky (`r/…`) s barvou, popisem a pořadím; při mazání lze příspěvky přesunout jinam
- štítky – z pole „Štítky“ i z #hashtagů v textu; přejmenování, sloučení, odstranění

**Náhled**
- náhled neuloženého příspěvku/stránky (tlačítko „Náhled“ otevře serverem vyrenderovanou stránku)
- živý náhled v editoru (záložka „Náhled“ – HTML vykresluje server)
- uložené koncepty lze prohlédnout na jejich adrese s označením „Náhled“

**Offline režim** (service worker + IndexedDB)
- všechny soubory jsou lokální – žádné CDN, fonty ani externí skripty
- navštívené stránky jsou dostupné i bez připojení
- příspěvky, úpravy, stránky, rubriky a komentáře odeslané offline se uloží do fronty
  a po obnovení spojení se **automaticky odešlou**
- aplikaci lze nainstalovat jako PWA

## Struktura

```
server.js              spuštění serveru
src/app.js             Express aplikace, middleware
src/db.js              schéma SQLite
src/models.js          databázové dotazy
src/auth.js            hesla, relace, CSRF
src/permissions.js     pravidla oprávnění
src/format.js          bezpečné formátování textu
src/routes/            routy (veřejné, přihlášení, nastavení, administrace)
views/                 EJS šablony (SSR)
public/                CSS, klientský JS, service worker, manifest
scripts/seed.js        ukázková data
test/                  integrační testy (node:test)
```
