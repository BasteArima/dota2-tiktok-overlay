# AGENTS.md

Заметки для разработки мода (людям и ИИ-агентам). Для игроков — [README.md](README.md).

## Что это

Мод интерфейса Dota 2 (Panorama): окно-браузер с TikTok / YouTube Shorts / Instagram Reels в главном
меню, на выборе героя и в матче. Репозиторий не содержит файлов Valve: `build.py` берёт их из установленной
игры пользователя, патчит и собирает `pak88_dir.vpk`.

| Файл | Зачем |
|---|---|
| `overlay.js` | весь код окна. Дописывается в конец двух скриптов игры. `__DD_CONFIG__` заменяется на `config.json` |
| `page.css` | дописывается в `panorama/browser/webkit.css`: стили внутри веб-страниц окна |
| `config.json` | сервисы, URL, горячая клавиша, размер окна |
| `build.py` | находит игру и папку модов, патчит ресурсы, пишет VPK, ставит его (`--key`, `--mod-dir`, `--game`, `--uninstall`) |
| `.github/workflows/release.yml` | сборка exe (PyInstaller) и релизы |
| `tests/` | тесты `overlay.js` на заглушке Panorama в Node.js |
| `tools/` | исследование файлов игры (см. ниже) |

## Проверка изменений

1. `python tests/run_tests.py` — нужен Node.js. Тесты не заменяют проверку в игре, но ловят поломки
   логики окна, вкладок, истории, фокуса и переходов меню ↔ матч.
2. `python build.py` при **закрытой** Доте (запущенная игра держит VPK открытым, будет PermissionError).
3. В игре: открыть окно в меню и в пробе героя, перетащить, изменить размер, переключить вкладки,
   стрелки ↓/↑ над окном, кнопки «вверх/вниз» сайтов, переход меню → матч → меню.
   Логи: `[TikTokMod]` в `game/bin/win64/vconsole2.exe` (Дота с `-vconsole`).

## Релиз

GitHub → Actions → **Build exe** → Run workflow, `version` = новый тег (`v1.2.2`), `notes` — строка описания.
Workflow сам соберёт exe, создаст тег и релиз (автор `github-actions[bot]`) на текущем `main`.
Через `gh`: `gh workflow run release.yml --ref main -f version=v1.2.2 -f "notes=..."`.
После релиза полезно проверить, что exe из релиза собирает тот же VPK, что и локальный `python build.py`
(сборка детерминирована, CRLF/LF не влияют).

## Как это устроено (что выяснено про движок)

- **Формат `_c`:** заголовок (размер файла, версия, таблица блоков: тип 4cc, смещение от поля, размер).
  У `.vjs_c` / `.vts_c` блок `DATA` — обычный JS. `build.py` заменяет только `DATA` и сдвигает блоки
  после него (`STAT`); `RED2` не трогается, игра это принимает. Разметка `.vxml_c` — бинарный KV3
  (блок `LaCo`, LZ4), её не пересобираем.
- **Точки входа:** `panorama/scripts/play.vts_c` (кнопка «Играть», грузится в главном меню) и
  `panorama/scripts/hud/hud_reborn.vjs_c` (корень HUD; выбор героя `DOTAHudPreGame` внутри него).
  Меню (`DOTADashboard`) и HUD (`DOTAHud`) — разные корневые окна, окно мода создаётся в каждом.
- **VPK:** v2, все данные в `_dir.vpk`. Моды подхватываются из папки `game/dota_<язык>` как
  `pakNN_dir.vpk`; Dota 2 Mod Manager помечает свою папку файлом `dota2modmanager.json`.
- **Панель `HTML`** — браузер клиента Steam (ISteamHTMLSurface), куки общие с оверлеем Steam.
  - Из JS есть только `SetURL` и `SetIgnoreCursor`. Ссылки `javascript:` заменяются пустой страницей.
  - События: `HTMLURLChanged` (аргументы: панель, url, ...), `HTMLFinishRequest`,
    `HTMLOpenPopupLink` / `HTMLOpenLinkInNewTab` (только с атрибутом `popuplinks`).
  - Атрибуты: `acceptsinput`, `acceptsfocus`, `focusonhover`, `popuplinks`, `manualscroll`.
  - Дочерняя `MousePanningImage` рисует стрелки в углу, мод её скрывает.
  - `panorama/browser/webkit.css` (в `core/pak01`) передаётся браузеру как стили для всех страниц,
    но с весом обычных стилей сайта: поэтому в `page.css` селекторы «утяжелены» повторами.
- **Ввод:** `GameUI.IsMouseDown(0)` / `GameUI.GetCursorPosition()` работают и в меню, и в HUD
  (перетаскивание и ресайз — опросом раз в кадр). `$.RegisterKeyBind("", "key_f8", cb)` — глобальный бинд;
  имена клавиш строчные: `key_f1`…`key_f12`, `key_a`, `key_insert`, `key_pageup`, `key_break`, `key_pad_0`…
- **Фокус клавиатуры:** пока курсор над окном, мод несколько раз в секунду вызывает `SetFocus()` и
  `$.DispatchEvent("SetInputFocus", html)`, при уходе — `DropInputFocus`. Нажатия (стрелки) доходят
  и в меню, и в матче; набор символов — только в меню (в матче движок не включает текстовый ввод,
  кроме своих полей и открытой консоли).
- **Состояние между окнами:** `GameUI.CustomUIConfig()` общий для всех контекстов. Экран игры —
  `$.RegisterForUnhandledEvent("DOTAGameUIStateChanged")`, последнее число в аргументах:
  1 загрузка, 2 матч, 3 главное меню.
- **Справка по JS API в игре:** консольные команды `cl_panorama_script_help <scope>` и
  `cl_panorama_typescript_declarations <scope>` (только для типов панелей, уже использованных из JS).

## Проверено и не работает (не повторять без новой идеи)

- Выполнить свой JS на странице: `RunJavascript` нет, `javascript:` блокируется → нет автолистания,
  паузы видео, «назад» через `history.back()`. Пауза = выгрузка (`about:blank`), «назад» = своя история.
- Колесо мыши не доводит ленту до следующего видео (scroll-snap не срабатывает в браузере игры).
  Атрибут `manualscroll` ломает прокрутку совсем. Panorama-события `MoveDown` / `ScrollDown` / `PageDown`
  браузер не листают. Решение — родные кнопки сайтов, показанные через `page.css`.
- Вход через Google/Facebook/Apple: им нужно всплывающее окно с `window.opener`. Открытие адреса из
  `HTMLOpenPopupLink` в том же окне доходит до `gsi/transform` и даёт чёрный экран. Страница браузера
  Доты (`BrowserGoToURL`) всплывающие окна тоже не умеет, `ExternalBrowserGoToURL` открывает внешний
  браузер. Рабочий путь — вход в оверлее Steam (Shift+Tab), куки общие.
- Набор текста в матче: захват ввода (`IInputCapture`) из JS недоступен.
- Instagram Reels в узком окне не создаёт кнопок навигации (их нет в DOM), CSS не поможет.

## Идеи и открытые вопросы

- Instagram: «план Б» — отрисовывать страницу шире окна (desktop-раскладка с кнопками) и показывать
  только нужную часть.
- Установка без Mod Manager (`dota_tempcontent` + `-language tempcontent`) не проверялась.
- Набор текста в матче при открытой консоли — наблюдение до исправления фокуса, не перепроверялось.
- В workflow действия на Node.js 20 (`checkout@v4`, `setup-python@v5`, `upload-artifact@v4`) — GitHub
  предупреждает об устаревании, обновить при отключении.

## После патча Доты

Обычно достаточно `python build.py`. Если меню или HUD сломались или окно не появилось:

- проверить, что точки входа существуют: `python tools/vpk.py list <game>/dota/pak01_dir.vpk 'panorama/scripts/*'`;
- найти, какие разметки подключают скрипт: `python tools/scan.py <game>/dota/pak01_dir.vpk > scan.txt`;
- поиск строк по всем разметкам и скриптам: `python tools/grep_layouts.py <pak01_dir.vpk> '<regex>' [контекст]`;
- поиск строк в DLL (имена JS-методов, событий, атрибутов): `python tools/strs.py <dll> '<regex>' [контекст]`;
- блоки ресурса: `python tools/res.py <file>_c [DATA|STAT|RED2]`.

## Правила

- Тексты для игроков (README, подсказки в окне) — на русском, обращение на «вы», коротко и просто.
- Никаких личных путей и данных в репозитории: он публичный. Скриншоты — с размытыми никами и аватарами.
- Изменения в `overlay.js` проверять тестами и в игре до релиза.
