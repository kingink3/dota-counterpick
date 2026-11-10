# Patch runbook — актуализация после патча Dota 2

Цель: после каждого патча прогонять фиксированный набор шагов. Скрипты делают
всё механическое, эксперт (ты) тратит время только на то, что изменилось.

## 0. Когда запускать

| Событие | Что прогонять | Оценка времени* |
|---|---|---|
| Большой патч (7.xx) | всё: A → B → C → D | 1–2 ч + ревью |
| Буквенный патч (7.xxa/b) | A1, B (только изменённые герои/предметы), D | 20–40 мин |
| Обновление клиента/UI без баланса | C (чтение экрана) | 10 мин |
| Новый герой | A1–A2, B5, C2, D | 30–60 мин |
| Раз в 2–4 недели внутри патча | A3–A4 (статистика, wiki), D | 15 мин |

\* прогноз, не замер.

## A. Автоматика (скрипты, без экспертизы)

1. **Детектор изменений — `npm run patch:check`** *(готово 2026-11-03)*
   `npm run patch:check` → `patch-report.md`; после ревью — `npm run patch:check -- --accept`
   (сохранить текущее состояние как baseline `data/constants-snapshot.json`).
   Недоступные предметы — одной строкой в `data/item_fit.yaml → unavailable`.
   Без сети / за прокси: см. сообщение скрипта (`--from <dir>`, `NODE_USE_ENV_PROXY=1`).
   Источник: npm-пакет `dotaconstants` (константы OpenDota: heroes, items,
   abilities, patch). Обновить пакет → сравнить с нашими данными → `patch-report.md`:
   - новые / удалённые герои (roster.json против heroes.json);
   - удалённые и ставшие нейтральными предметы (cost = 0; tier → нейтральный) среди
     всех id, на которые ссылаются items.yaml, item_fit.yaml, defense.yaml,
     item_edges.yaml и wiki-слой;
   - новые покупаемые предметы (кандидаты в items.yaml / item_fit.yaml);
   - герои, у которых изменились способности (hero_abilities.json / abilities.json,
     diff с прошлым снапшотом) → **очередь ревью** для B5;
   - смена типа атаки (melee/ranged);
   - герои ростера без записи в `hero_tags` (новый герой = затемнён в UI, не
     предлагается в пик) → обязательный пункт B5;
   - устаревшие способности в wiki-текстах: многословные имена из `abilities.json`,
     которых нет у текущих героев, фасетов, талантов, предметов и нейтралов
     (`neutral_abilities.json`). Скрипт пишет найденные имена в
     `data/retired-abilities.json`; KB показывает следующую актуальную заметку героя
     или убирает wiki-пункт, если актуальной нет (Poison Nova, Tar Bomb → автоматически).
     Отчёт: сколько заметок затронуто + страховка «что реально показывается».
     Новые устаревшие имена → пункт «re-scrape the wiki». Исключения —
     `data/constants-map.yaml → abilities_still_current` (Brewmaster, Spirit Bear,
     Golem) и `mechanic_terms` (Spell Immunity, True Strike, Spell Block).
   Снапшот констант сохранять в `data/constants-snapshot.json`, чтобы следующий diff
   был от него.
2. **Ростер и портреты:** `npm run build:roster` (+ attack), `npm run fetch:portraits`.
   Новые портреты = автоматически новые шаблоны для чтения экрана.
   Иконки предметов (чтение вещей врага, ADR-025): Actions → «Fetch item icons» → Run
   workflow — докачает новые предметы и обновит `web/items/index.json`.
3. **Статистика:** пересобрать `data/matchups.json` (build-matchups), но не раньше чем
   через 1–2 недели после большого патча, иначе выборка мала. Проверить, фильтрует ли
   источник по патчу — сейчас данные без метки патча *(не проверено)*.
4. **Wiki:** `npm run scrape:counters` через 1–2 недели (вики обновляется с задержкой);
   в отчёт — diff по героям: какие «Bad against / Items» изменились.

## B. Экспертное ревью (по очереди из отчёта A1)

5. **Герои с изменёнными способностями** → `data/hero_damage.yaml`: доли урона
   [physical, magic, pure] (ADR-059; у нового героя строка обязательна — без неё KB даёт
   предупреждение и тест падает); `taxonomy.yaml` hero_tags: теги и веса
   (включая `resist` и `pierced_by` — ADR-020: новая защита/обход защиты),
   `special_cases` (ловушки вроде Shadow Dance ≠ invis), `hero_edges.yaml`,
   `item_fit.yaml` → `archetype_override`, если сменилась роль.
   Сверка с howdoiplay.com (обновляется под патчи):
   `git clone --depth 1 https://github.com/tsunami643/tsunami643.github.io <dir>` →
   `npm run review:howdoiplay -- --site <dir>` → `howdoiplay-report.md`: контрпики,
   названные на сайте, которых движок не предлагает. Повторяющуюся механику — в теги,
   явный контрпик — в `hero_edges.yaml`, связку — в `data/combos.yaml`; текст сайта не
   копировать (лицензии нет), писать своими словами (ADR-021).
6. **Предметы:**
   - удалённые → убрать из items.yaml, item_fit.yaml, defense.yaml, item_edges.yaml;
   - новые → tool-теги (items.yaml) + строка fit (тест не пропустит предмет без неё);
   - переработанные → перепроверить теги и fit.
7. **Тайминги карты** (`data/timings.yaml`, ADR-026): пройти патчноуты на руны,
   святилища, лотосы, Tormentor, Рошана, тиры нейтралок, день/ночь; у каждой правки —
   `source` со ссылкой на патч; обновить `patch` и `reviewed`. Тест
   `test/game.test.ts` проверяет расписание на опорных моментах.
8. **Метка патча:** `taxonomy.yaml → meta.patch: "7.xx"` и `meta.reviewed: <дата>`;
   показывать в UI («KB: patch 7.xx») *(сделать)*.

## B2. Статистика сборок (ADR-027), через 2–3 недели после патча

1. Actions → «Fetch OpenDota stats» → Run workflow. Около 10 минут, 4 запроса на героя, сырые данные в ветке `opendota-raw`.
2. Локально:
   `git fetch origin opendota-raw && git worktree add /tmp/od origin/opendota-raw` →
   `npx tsx scripts/build-item-stats.ts --raw /tmp/od --constants <dotaconstants/build>` →
   коммит `data/item-stats.json`.
3. Проверка: `npm test` (`test/plan.test.ts` гоняет правила порядка на реальных данных для 5 героев).
4. STRATZ (ранги Crusader–Archon + Legend–Ancient, по позициям; план предпочитает эти данные):
   - Actions → «Fetch STRATZ stats», mode=fetch. Секрет `STRATZ_TOKEN`; ~66 вызовов за запуск.
   - **Не больше 2 запусков за 15 минут:** STRATZ пускает не больше 2 IP за 15 минут, а у каждого запуска Actions свой IP.
   - Требуется 100 публичных игр на аккаунте владельца токена.
   - Новые герои / сдвиг позиций → `git show origin/stratz-raw:positions.json > /tmp/p.json && npx tsx scripts/build-stratz-queries.ts /tmp/p.json`, коммит `scripts/stratz/<dataset>.json`.
   - Сборка: `git worktree add /tmp/stz origin/stratz-raw` → `build-item-stats.ts ... --stratz /tmp/stz`.

## C. Чтение экрана (регрессия)

1. **Фикстуры:** `test/fixtures/draft-<res>-pre.png` / `-post.png` + ожидаемые
   герои/свой слот в JSON. e2e `npm run test:screen` прогоняет их через тот же
   распознаватель *(сделать: сохранить твои скриншоты 1440p как первые фикстуры)*.
2. После обновления клиента — 2 новых скриншота (до/после пика) → прогон. Если упало:
   - сдвинулись слоты → перекалибровать константы `SLOT` / `NAME` (скрипт автоподбора
     смещения, как при первой калибровке) *(сделать)*;
   - сменился арт портретов → `fetch:portraits` (шаблоны строятся из них);
   - поменялась подпись своего ника → пороги `NAME_THRESHOLDS`;
   - сменился шрифт часов → кадры в `test/fixtures/clock.json`, затем
     `npx tsx scripts/build-clock-glyphs.ts`;
   - сменилась рамка инвентаря → новый эталон `src/hud-anchor.ts` (рамка без
     содержимого слотов, половинное разрешение) и окна в `test/fixtures/hud-items.json`.

## D. Проверка и фиксация

1. `npm run typecheck && npm test` + новые проверки *(сделать)*:
   - ни один файл KB не ссылается на удалённый предмет / героя;
   - у каждого героя ростера есть портрет;
   - у каждого рекомендуемого предмета есть строка fit (уже есть).
2. **Golden-драфты** *(готово 2026-11-09, ADR-059)*: `test/golden.test.ts`, 8 драфтов в
   `test/fixtures/golden-drafts.json` → топ-5 героев и предметов, топ-4 защиты, школа урона.
   После правок тест падает на изменившихся; подтвердить глазами и обновить:
   `UPDATE_GOLDEN=1 npx tsx --test test/golden.test.ts` — diff «было/стало» виден в коммите.
3. **Базовые уровни и сверка KB с данными** *(ADR-061)* — после любой правки KB или
   обновления `data/matchups.json`:
   - `npm run build:baselines` → `data/baselines.json` (тест падает, если файл устарел);
   - `npm run kb:validate` → `KB_VALIDATION.md`: если `KB_PP_PER_POINT` или
     `STAT_PRIOR_GAMES` в отчёте ушли от значений в `src/params.ts` больше чем на ~15% —
     обновить их;
   - таблица правил: правило с «п.п. за балл» далеко от общего наклона — кандидат на правку
     `pick_weight` в `taxonomy.yaml` (ADR-062; `weight` для предметов не трогать);
   - раздел «Tag suggestions»: тег добавлять только при реальной способности;
   - списки «пропущено / опровергнуто» — материал для новых общих рёбер (не для точечной
     правки героев).
4. `npm run build:web`, ручной смоук: Test a screenshot + один живой драфт.
5. Запись: строка в `CHANGELOG.md` (что поменялось в KB) и, если менялись правила, ADR.

## Автоматизация (порядок внедрения)

1. `patch:check` + снапшот констант — даёт 80% пользы: список «что смотреть».
2. Фикстуры скриншотов + `test:screen`.
3. Golden-драфты (diff рекомендаций).
4. `patch:update` — оркестратор: A1 → A2 → (A3, A4 по флагу) → тесты → стоп на
   экспертном ревью с готовым отчётом.

## Первый пробный прогон (2026-11-03, вручную)

- dotaconstants: последний патч в пакете — **7.41** (24.03.2026). KB помечена «≈ начало
  2026» → совпадает ли с текущим живым патчем, нужно сверить.
- Герои: 127 в ростере = 127 в константах — новых нет.
- **Предметы, которых нет в магазине** (cost = 0): Hood of Defiance, Dragon Scale,
  Book of the Dead, Medallion of Courage → внесены в `unavailable` (B6, сделано).
- Baseline для diff способностей создан 2026-11-03 (dotaconstants 10.8.0, 7.41).

## Инструменты героев (ADR-032)
- После патча: `npx tsx scripts/audit-tools.ts --constants <dotaconstants/build>` — герои, у которых способности показывают механику, которой нет в их `tool` (taxonomy.yaml, hero_tags). Реальное — дописать с весом и комментарием; совпадение текста — в `REVIEWED` с причиной.

