
// ===== Shorts overlay mod (appended by dota_tiktok_mod/build.py) =====
(function () {
    const CONFIG = __DD_CONFIG__; // replaced with config.json by build.py
    const MOD_ID = "DDShortsOverlay";
    const ICONS = "file://{images}/control_icons/24px/";
    const HOTKEYS = ["f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "insert", "home", "end",
        "pageup", "pagedown", "scrolllock", "break", "backquote"];
    const KEY_NAMES = { pageup: "PgUp", pagedown: "PgDn", scrolllock: "ScrollLock", "break": "Pause", backquote: "`" };
    const HEADER_H = 36, MIN_W = 300, MIN_H = 320, HISTORY_MAX = 50;
    const BTN_BG = "#ffffff14", BTN_HOVER = "#ffffff33";
    // The HTML panel only exposes SetURL (javascript: URLs are replaced with a blank page),
    // so pausing = unloading the page and resuming = loading the last known URL again.
    const BLANK_URL = "about:blank";
    // DOTAGameUIState_t, sent with the DOTAGameUIStateChanged event
    const UI_LOADING = 1, UI_INGAME = 2, UI_DASHBOARD = 3;

    function log(msg) { $.Msg("[TikTokMod] " + msg); }
    function keyLabel(k) { return KEY_NAMES[k] || k.toUpperCase(); }
    function service(id) { return CONFIG.services.find(s => s.id === id) || CONFIG.services[0]; }
    function isWebUrl(u) { return typeof u === "string" && /^https?:\/\//.test(u); }

    function css(panel, styles) {
        for (const k in styles) panel.style[k] = styles[k];
        return panel;
    }
    function setBg(btn, color) { btn.__bg = color; btn.style.backgroundColor = color; }
    function xy(v) { return Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }; }
    function hit(panel, c) {
        if (!panel || !panel.IsValid() || !panel.visible) return false;
        const p = xy(panel.GetPositionWithinWindow());
        return c.x >= p.x && c.y >= p.y && c.x <= p.x + panel.actuallayoutwidth && c.y <= p.y + panel.actuallayoutheight;
    }

    // State shared between the menu and HUD windows (GameUI.CustomUIConfig is common to all UI contexts).
    function getShared() {
        let holder = null;
        try { holder = GameUI.CustomUIConfig(); } catch (e) { log("CustomUIConfig unavailable: " + e); }
        holder = holder || {};
        if (!holder[MOD_ID]) {
            holder[MOD_ID] = {
                state: {
                    service: CONFIG.services[0].id, hotkey: CONFIG.hotkey, showToggle: CONFIG.showToggleButton !== false,
                    keepPlaying: false, rect: null, urls: {},
                },
                instances: [], lastKeyAt: 0,
                uiState: null,    // last DOTAGameUIStateChanged value
                wantOpen: false,  // a window was open when the UI state changed: reopen it on the next screen
            };
        }
        return holder[MOD_ID];
    }
    // which window is on screen: the menu (dashboard) or the match HUD; null while loading
    function activeKind(shared) {
        if (shared.uiState === UI_DASHBOARD) return "menu";
        if (shared.uiState === UI_INGAME) return "hud";
        if (shared.uiState === UI_LOADING) return null;
        return alive(shared).some(i => i.kind === "hud") ? "hud" : "menu";
    }
    function activeInstance(shared) {
        const kind = activeKind(shared);
        return kind && alive(shared).find(i => i.kind === kind);
    }
    function onUiState(shared, state) {
        if (typeof state !== "number" || state === shared.uiState) return;
        log("UI state " + shared.uiState + " -> " + state);
        shared.uiState = state;
        each(shared, i => {
            if (i.isOpen()) { i.setOpen(false, true); shared.wantOpen = true; }
        });
        const target = activeInstance(shared);
        if (!target) return; // loading screen, or the HUD window is not built yet (it checks wantOpen itself)
        target.raise();
        if (shared.wantOpen) { shared.wantOpen = false; target.setOpen(true); }
    }
    function alive(shared) {
        shared.instances = shared.instances.filter(i => { try { return i.alive(); } catch (e) { return false; } });
        return shared.instances;
    }
    function each(shared, fn) {
        alive(shared).forEach(i => { try { fn(i); } catch (e) { log("instance call failed: " + e); } });
    }
    function onHotkey(shared, key) {
        if (shared.state.hotkey !== key) return;
        const now = Date.now();
        if (now - shared.lastKeyAt < 150) return; // every window registers the key; handle one press once
        shared.lastKeyAt = now;
        const target = activeInstance(shared);
        if (!target) return log("hotkey: no window for UI state " + shared.uiState);
        target.setOpen(!target.isOpen());
    }

    function build(root, shared) {
        const S = shared.state;
        const ctx = $.GetContextPanel();
        const kind = (ctx.paneltype === "DOTAHud" || root.FindChildTraverse("HUDElements")) ? "hud" : "menu";
        const tabs = {};      // service id -> header button
        const browsers = {};  // service id -> { html, history: [], loaded: bool, redirectUntil: ms }
        const boundKeys = {};
        const buttons = [];   // header buttons (not a drag handle)
        let ticking = false, drag = null, wasDown = false, tickCount = 0, pendingKey = null;
        let keyFocus = null;  // the browser panel that currently has keyboard focus

        const overlay = css($.CreatePanel("Panel", root, MOD_ID), { width: "100%", height: "100%" });
        overlay.hittest = false;

        // ---- own tooltip (the game's tooltip layer is drawn below this overlay) ----
        let tip = null;
        function showTip(panel, text) {
            if (!tip || !panel.IsValid()) return;
            const sc = scale(), p = xy(panel.GetPositionWithinWindow()), s = screen();
            const w = text.length * 8 + 20;
            let x = p.x / sc + panel.actuallayoutwidth / sc / 2 - w / 2;
            let y = (p.y + panel.actuallayoutheight) / sc + 6;
            if (y + 34 > s.h) y = p.y / sc - 34;
            x = Math.max(4, Math.min(x, s.w - w - 4));
            tip.text = text;
            css(tip, { width: w + "px", position: x + "px " + y + "px 0px" });
            tip.visible = true;
        }
        function hideTip() { if (tip) tip.visible = false; }
        function hover(panel, text) {
            panel.SetPanelEvent("onmouseover", () => { panel.style.backgroundColor = BTN_HOVER; showTip(panel, text); });
            panel.SetPanelEvent("onmouseout", () => { panel.style.backgroundColor = panel.__bg || BTN_BG; hideTip(); });
        }
        function textButton(parent, text, tipText, onClick) {
            const b = css($.CreatePanel("Button", parent, ""), {
                height: "30px", minWidth: "30px", marginRight: "3px", padding: "0px 7px", backgroundColor: BTN_BG, borderRadius: "4px",
            });
            const l = css($.CreatePanel("Label", b, ""), {
                color: "#ffffff", fontSize: "15px", fontWeight: "bold", horizontalAlign: "center", verticalAlign: "center",
            });
            l.text = text;
            b.__label = l;
            b.SetPanelEvent("onactivate", onClick);
            hover(b, tipText);
            return b;
        }
        function iconButton(parent, icon, tipText, onClick) {
            const b = css($.CreatePanel("Button", parent, ""), {
                width: "30px", height: "30px", marginLeft: "3px", backgroundColor: BTN_BG, borderRadius: "4px",
            });
            const img = $.CreatePanel("Image", b, "", { src: ICONS + icon + ".vsvg", scaling: "stretch-to-fit-preserve-aspect" });
            css(img, { width: "18px", height: "18px", horizontalAlign: "center", verticalAlign: "center", washColor: "#ffffff" });
            b.SetPanelEvent("onactivate", onClick);
            hover(b, tipText);
            return b;
        }

        // ---- window ----
        const win = css($.CreatePanel("Panel", overlay, ""), {
            flowChildren: "down", backgroundColor: "#0b0b0ff5", border: "2px solid #fe2c55", borderRadius: "8px",
            boxShadow: "#000000cc 0px 0px 16px 0px",
        });
        win.hittest = true;
        win.visible = false;

        const header = css($.CreatePanel("Panel", win, ""), {
            width: "100%", height: HEADER_H + "px", flowChildren: "right", padding: "3px", backgroundColor: "#000000",
        });
        CONFIG.services.forEach(svc => {
            tabs[svc.id] = textButton(header, svc.short, svc.name + " (ещё клик: на главную)", () => onTab(svc.id));
            buttons.push(tabs[svc.id]);
        });
        css($.CreatePanel("Panel", header, ""), { width: "fill-parent-flow(1.0)", height: "100%" }); // drag area
        buttons.push(
            iconButton(header, "arrow_left", "Назад", goBack),
            iconButton(header, "refresh", "Обновить", reload),
            iconButton(header, "settings", "Настройки", () => showSettings(!settings.visible)),
            iconButton(header, "x_close", "Скрыть", () => setOpen(false)));

        const body = css($.CreatePanel("Panel", win, ""), { width: "100%", height: "fill-parent-flow(1.0)" });
        const layer = css($.CreatePanel("Panel", body, ""), { width: "100%", height: "100%" });

        // ---- settings ----
        const settings = css($.CreatePanel("Panel", body, ""), {
            width: "100%", height: "100%", flowChildren: "down", padding: "16px", backgroundColor: "#0b0b0ffa",
        });
        settings.visible = false;
        function settingRow(title) {
            const row = css($.CreatePanel("Panel", settings, ""), { width: "100%", flowChildren: "right", marginBottom: "10px" });
            const l = css($.CreatePanel("Label", row, ""), {
                color: "#ffffffcc", fontSize: "16px", width: "fill-parent-flow(1.0)", verticalAlign: "center",
            });
            l.text = title;
            return row;
        }
        const keyBtn = textButton(settingRow("Горячая клавиша"), "", "Клик: следующая клавиша", () => {
            pendingKey = HOTKEYS[(HOTKEYS.indexOf(pendingKey || S.hotkey) + 1) % HOTKEYS.length];
            refresh();
        });
        const soundBtn = textButton(settingRow("Звук при скрытии окна"), "", "Остановить = выгрузить страницу", () => {
            S.keepPlaying = !S.keepPlaying;
            each(shared, i => i.refresh());
        });
        const toggleRowBtn = textButton(settingRow("Кнопка на краю экрана"), "", "Показать или скрыть", () => {
            S.showToggle = !S.showToggle;
            each(shared, i => i.refresh());
        });
        textButton(settingRow("Положение и размер окна"), "Сбросить", "Вернуть как было", () => { S.rect = null; applyRect(); });
        // Sign-in with Google/Facebook/Apple needs popup windows, which this panel can't host. The Steam overlay
        // browser can, and it shares cookies with this panel, so logging in there once is enough.
        textButton(settingRow("Войти через браузер Steam"), "Открыть", "Открыть сервис в оверлее Steam (Shift+Tab)", () => {
            const url = lastUrl(S.service);
            log("login via ExternalBrowserGoToURL: " + url);
            setOpen(false);
            try { $.DispatchEvent("ExternalBrowserGoToURL", url); } catch (e) { log("ExternalBrowserGoToURL failed: " + e); }
        });
        const note = css($.CreatePanel("Label", settings, ""), { color: "#ffffff88", fontSize: "13px", marginTop: "8px", width: "100%" });
        note.text = "Клавиша применяется при закрытии настроек и действует до перезапуска Доты, " +
            "постоянная задаётся через python build.py --key f9.\n\n" +
            "Печатать (логин, коды, поиск) можно в главном меню. В матче нажми Esc: откроется меню, " +
            "и это окно будет там на той же странице. Или открой консоль Доты, пока она открыта, ввод работает.\n\n" +
            "Google, Facebook и Apple в этом окне не входят. Войди на сайте в оверлее Steam " +
            "(Shift+Tab или кнопка «Открыть» выше), закрой его и нажми «обновить» в окне.";

        function showSettings(show) {
            settings.visible = show;
            if (!show && pendingKey) { S.hotkey = pendingKey; pendingKey = null; each(shared, i => i.bindKeys()); }
            refresh();
        }

        // ---- resize grip ----
        const grip = css($.CreatePanel("Panel", body, ""), {
            width: "24px", height: "24px", horizontalAlign: "right", verticalAlign: "bottom",
            backgroundColor: "#000000b0", borderRadius: "6px 0px 6px 0px",
        });
        const gripImg = $.CreatePanel("Image", grip, "", { src: ICONS + "arrow_bottom_right.vsvg", scaling: "stretch-to-fit-preserve-aspect" });
        css(gripImg, { width: "16px", height: "16px", horizontalAlign: "center", verticalAlign: "center", washColor: "#ffffff" });
        hover(grip, "Потяни, чтобы изменить размер");

        // ---- edge toggle button ----
        const toggleBtn = css($.CreatePanel("Button", overlay, ""), {
            width: "44px", height: "44px", horizontalAlign: "left", verticalAlign: "center", borderRadius: "0px 8px 8px 0px", opacity: "0.85",
        });
        const toggleLabel = css($.CreatePanel("Label", toggleBtn, ""), {
            color: "#ffffff", fontSize: "18px", fontWeight: "bold", horizontalAlign: "center", verticalAlign: "center",
        });
        toggleBtn.SetPanelEvent("onactivate", () => setOpen(!win.visible));
        toggleBtn.SetPanelEvent("onmouseover", () => toggleBtn.style.opacity = "1");
        toggleBtn.SetPanelEvent("onmouseout", () => toggleBtn.style.opacity = "0.85");

        // created last so it draws above everything in the overlay
        tip = css($.CreatePanel("Label", overlay, ""), {
            color: "#ffffff", fontSize: "14px", padding: "6px 10px", backgroundColor: "#000000ee",
            border: "1px solid #ffffff33", borderRadius: "4px", textAlign: "center",
        });
        tip.hittest = false;
        tip.visible = false;

        // ---- geometry ----
        function scale() { return root.actualuiscale_y || 1; }
        function screen() { return { w: root.actuallayoutwidth / scale(), h: root.actuallayoutheight / scale() }; }
        function clampRect(r) {
            const s = screen();
            if (!s.w || !s.h) return r;
            const w = Math.max(MIN_W, Math.min(r.w, s.w - 10)), h = Math.max(MIN_H, Math.min(r.h, s.h - 10));
            return { w, h, x: Math.max(0, Math.min(r.x, s.w - w)), y: Math.max(0, Math.min(r.y, s.h - h)) };
        }
        function defaultRect() {
            const s = screen(), w = CONFIG.width, h = CONFIG.height;
            return { w, h, x: Math.max(0, s.w - w - 40), y: Math.max(0, (s.h - h) / 2) };
        }
        function applyRect() {
            S.rect = clampRect(S.rect || defaultRect());
            const r = S.rect;
            css(win, { width: r.w + "px", height: r.h + "px", position: r.x + "px " + r.y + "px 0px" });
        }

        // mouse polling: drag by the header, resize by the grip
        function tick() {
            if (!win.IsValid() || !win.visible) { ticking = false; drag = null; return; }
            try {
                const down = GameUI.IsMouseDown(0);
                const c = xy(GameUI.GetCursorPosition());
                if (down && !wasDown) {
                    const r = S.rect;
                    if (hit(grip, c)) drag = { mode: "resize", c, r: Object.assign({}, r) };
                    else if (hit(header, c) && !buttons.some(b => hit(b, c))) drag = { mode: "move", c, r: Object.assign({}, r) };
                    if (drag) hideTip();
                }
                if (!down) drag = null;
                wasDown = down;
                if (drag) {
                    const dx = (c.x - drag.c.x) / scale(), dy = (c.y - drag.c.y) / scale();
                    S.rect = drag.mode === "move"
                        ? { w: drag.r.w, h: drag.r.h, x: drag.r.x + dx, y: drag.r.y + dy }
                        : { x: drag.r.x, y: drag.r.y, w: drag.r.w + dx, h: drag.r.h + dy };
                    applyRect();
                }
                // keyboard goes to the page only while the cursor is over the window, otherwise to the game
                // (the game can take focus back, so keep re-asserting it a few times per second)
                const cur = browsers[S.service];
                if (hit(win, c) && !settings.visible && cur && cur.html.IsValid()) {
                    if (keyFocus !== cur.html || tickCount % 15 === 0) giveKeys(cur.html);
                } else if (keyFocus && !drag) {
                    takeKeys();
                }
                if (tickCount++ % 30 === 0) for (const id in browsers) hidePanCursor(browsers[id].html);
            } catch (e) {
                log("tick error: " + e);
            }
            $.Schedule(1 / 60, tick);
        }

        // ---- browsers ----
        let focusLogged = false;
        function giveKeys(html) {
            try { html.SetFocus(); } catch (e) { log("SetFocus failed: " + e); }
            try { $.DispatchEvent("SetInputFocus", html); } catch (e) { log("SetInputFocus failed: " + e); }
            keyFocus = html;
            if (!focusLogged) { focusLogged = true; log("keyboard -> browser"); }
        }
        function takeKeys() {
            try { if (keyFocus.IsValid()) $.DispatchEvent("DropInputFocus", keyFocus); } catch (e) { log("DropInputFocus failed: " + e); }
            keyFocus = null;
        }
        function hidePanCursor(html) {
            // the HTML panel draws a 4-arrow "mouse panning" image in its corner; we don't need it
            const img = html.IsValid() && html.FindChildTraverse("MousePanningImage");
            if (img && img.visible) img.visible = false;
        }
        function lastUrl(id) { return S.urls[id] || service(id).url; }
        function navigate(id, url) {
            const b = browsers[id];
            b.loaded = url !== BLANK_URL;
            b.redirectUntil = Date.now() + 3000; // URL changes right after our own navigation are redirects
            b.html.SetURL(url);
        }
        function onUrlChanged(id) {
            let logged = 0;
            return function () {
                const strs = Array.prototype.slice.call(arguments).filter(a => typeof a === "string");
                const url = strs.find(isWebUrl);
                if (!url) {
                    if (logged++ < 2) log("HTMLURLChanged [" + id + "] non-web: " + strs.map(s => s.slice(0, 60)).join(" | "));
                    return;
                }
                const b = browsers[id];
                if (!b.loaded) return; // a late event from a page we have just unloaded
                S.urls[id] = url;
                const h = b.history;
                if (h[h.length - 1] === url) return;
                if (Date.now() < b.redirectUntil && h.length) h[h.length - 1] = url;
                else h.push(url);
                if (h.length > HISTORY_MAX) h.shift();
            };
        }
        function getBrowser(id) {
            if (browsers[id] && browsers[id].html.IsValid()) return browsers[id];
            const url = lastUrl(id);
            const pid = MOD_ID + "_" + id;
            let html = null;
            try {
                html = $.CreatePanel("HTML", layer, pid, { url: url, acceptsinput: "true", acceptsfocus: "true", focusonhover: "true" });
            } catch (e) { log("CreatePanel(HTML) failed: " + e); }
            if (!html) {
                layer.BCreateChildren('<HTML id="' + pid + '" url="' + url + '" acceptsinput="true" acceptsfocus="true" focusonhover="true" />');
                html = layer.FindChildTraverse(pid);
            }
            if (!html) { log("could not create HTML panel"); return null; }
            css(html, { width: "100%", height: "100%" });
            browsers[id] = { html, history: [url], loaded: true, redirectUntil: Date.now() + 3000 };
            try { $.RegisterEventHandler("HTMLURLChanged", html, onUrlChanged(id)); } catch (e) { log("no HTMLURLChanged: " + e); }
            html.SetURL(url);
            hidePanCursor(html);
            return browsers[id];
        }
        function suspend(id) {
            const b = browsers[id];
            if (b && b.html.IsValid() && b.loaded) navigate(id, BLANK_URL);
        }
        function suspendAll() { for (const id in browsers) suspend(id); }
        function showService(id) {
            if (S.service !== id) suspend(S.service);
            S.service = id;
            const b = getBrowser(id);
            if (b && !b.loaded) navigate(id, lastUrl(id));
            for (const bid in browsers) if (browsers[bid].html.IsValid()) browsers[bid].html.visible = bid === id;
            each(shared, i => i.refresh());
        }
        function onTab(id) {
            if (S.service === id && browsers[id]) {
                browsers[id].history = [];
                navigate(id, service(id).url);
            } else {
                showService(id);
            }
        }
        function goBack() {
            const b = browsers[S.service];
            if (!b || b.history.length < 2) return;
            b.history.pop();
            navigate(S.service, b.history[b.history.length - 1]);
        }
        function reload() {
            const b = browsers[S.service];
            if (b) navigate(S.service, lastUrl(S.service));
        }

        // ---- open / close ----
        // forceSuspend: unload pages even if "keep playing" is on (another window took over)
        function setOpen(open, forceSuspend) {
            hideTip();
            if (open) {
                each(shared, i => { if (i !== instance) i.setOpen(false, true); });
                raise();
                applyRect();
                win.visible = true;
                showService(S.service);
                if (!ticking) { ticking = true; tick(); }
            } else {
                if (settings.visible) showSettings(false);
                if (keyFocus) takeKeys();
                win.visible = false;
                if (!S.keepPlaying || forceSuspend) suspendAll();
            }
        }

        function refresh() {
            const svc = service(S.service);
            CONFIG.services.forEach(s => setBg(tabs[s.id], s.id === S.service ? s.color : BTN_BG));
            win.style.border = "2px solid " + svc.color;
            toggleBtn.style.backgroundColor = svc.color;
            toggleLabel.text = svc.short;
            toggleBtn.visible = S.showToggle;
            keyBtn.__label.text = keyLabel(pendingKey || S.hotkey) + (pendingKey ? " *" : "");
            soundBtn.__label.text = S.keepPlaying ? "Продолжать" : "Остановить";
            toggleRowBtn.__label.text = S.showToggle ? "Показывать" : "Скрыта";
        }

        function bindKeys() {
            const k = S.hotkey;
            if (boundKeys[k]) return;
            try {
                $.RegisterKeyBind("", "key_" + k, () => onHotkey(shared, k));
                boundKeys[k] = true;
            } catch (e) { log("RegisterKeyBind key_" + k + " failed: " + e); }
        }

        // keep the overlay above panels the game adds to the window root later (e.g. after a match)
        function raise() {
            try {
                const last = root.GetChild(root.GetChildCount() - 1);
                if (last && last !== overlay) root.MoveChildAfter(overlay, last);
            } catch (e) { log("raise failed: " + e); }
        }

        const instance = {
            kind,
            alive: () => root.IsValid() && overlay.IsValid(),
            isOpen: () => win.visible,
            setOpen, refresh, bindKeys, raise,
        };
        shared.instances.push(instance);
        bindKeys();
        refresh();
        try {
            $.RegisterForUnhandledEvent("DOTAGameUIStateChanged", function () {
                const nums = Array.prototype.slice.call(arguments).filter(a => typeof a === "number");
                onUiState(shared, nums[nums.length - 1]); // (old, new) or just (new)
            });
        } catch (e) { log("no DOTAGameUIStateChanged: " + e); }
        if (shared.uiState === null) shared.uiState = kind === "hud" ? UI_INGAME : UI_DASHBOARD;
        if (kind === "hud") {
            // a match started: silence the menu window, and continue here if it was open
            each(shared, i => { if (i !== instance && i.isOpen()) { i.setOpen(false, true); shared.wantOpen = true; } });
        }
        if (shared.wantOpen && activeKind(shared) === kind) { shared.wantOpen = false; setOpen(true); }
        log("ready: " + kind + ", hotkey " + S.hotkey + ", UI state " + shared.uiState + ", windows " + alive(shared).length);
    }

    function init() {
        try {
            let root = $.GetContextPanel();
            while (root && root.GetParent()) root = root.GetParent();
            if (!root) return log("no root panel");
            if (root.FindChild(MOD_ID)) return; // already injected into this window
            build(root, getShared());
        } catch (e) {
            log("init error: " + e);
        }
    }

    // let the original layout finish building before attaching to the window root
    $.Schedule(1.0, init);
})();
