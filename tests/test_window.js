// One UI window (main menu context) with a minimal Panorama mock.
// Usage: node tests/test_window.js <overlay.js with config substituted>   (tests/run_tests.py does this)
const assert = require("assert");
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");

let scheduled = [];
const keybinds = {};
const events = {};
const urls = [];
let mouseDown = false, cursor = [0, 0], focus = null;

function Panel(type, parent, id) {
    this.paneltype = type; this.id = id || ""; this.children = []; this.parent = parent; this.style = {};
    this.visible = true; this.hittest = true; this.events = {}; this.text = "";
    this.actuallayoutwidth = 0; this.actuallayoutheight = 0; this.actualuiscale_x = 1; this.actualuiscale_y = 1;
    if (parent) parent.children.push(this);
}
Panel.prototype.GetParent = function () { return this.parent; };
Panel.prototype.IsValid = function () { return true; };
Panel.prototype.FindChild = function (id) { return this.children.find(c => c.id === id) || null; };
Panel.prototype.FindChildTraverse = function (id) {
    for (const c of this.children) { if (c.id === id) return c; const r = c.FindChildTraverse(id); if (r) return r; }
    return null;
};
Panel.prototype.SetFocus = function () { focus = this; };
Panel.prototype.SetPanelEvent = function (n, f) { this.events[n] = f; };
Panel.prototype.SetURL = function (u) { urls.push([this.id, u]); };
Panel.prototype.GetPositionWithinWindow = function () {
    let x = 0, y = 0;
    for (let p = this; p; p = p.parent) {
        const m = /(-?[\d.]+)px (-?[\d.]+)px/.exec(p.style.position || "");
        if (m) { x += +m[1]; y += +m[2]; }
    }
    return { x, y };
};

const root = new Panel("Panel", null, "");
root.actuallayoutwidth = 1920; root.actuallayoutheight = 1080;
const ctx = new Panel("DOTAPlay", root, "ctx");
const shared = {};
global.$ = {
    Msg: () => {},
    GetContextPanel: () => ctx,
    Schedule: (t, f) => scheduled.push(f),
    CreatePanel: (type, parent, id, props) => { const p = new Panel(type, parent, id); Object.assign(p, props || {}); return p; },
    DispatchEvent: (n) => { if (n === "DropInputFocus") focus = null; },
    RegisterKeyBind: (ctxName, key, cb) => { keybinds[key] = cb; },
    RegisterEventHandler: (n, p, cb) => { events[n] = cb; },
    RegisterForUnhandledEvent: () => {},
};
global.GameUI = { CustomUIConfig: () => shared, IsMouseDown: () => mouseDown, GetCursorPosition: () => cursor };
const flush = () => { const s = scheduled; scheduled = []; s.forEach(f => f()); };
const lastUrlOf = id => urls.filter(u => u[0].endsWith(id)).slice(-1)[0][1];

eval(src);
flush();
const overlay = root.FindChild("DDShortsOverlay");
assert(overlay, "overlay created in the window root");
const [win, toggle] = overlay.children;
const S = shared.DDShortsOverlay.state;
assert.deepStrictEqual(Object.keys(keybinds), ["key_f8"], "default hotkey bound");

// open via the edge button
toggle.events.onactivate();
assert(win.visible, "window opens");
assert.deepStrictEqual(S.rect, { w: 420, h: 780, x: 1460, y: 150 }, "default rect: right side, centered");

// drag by the header
const header = win.children[0];
header.actuallayoutwidth = 420; header.actuallayoutheight = 36;
cursor = [S.rect.x + 200, S.rect.y + 10]; mouseDown = true; flush();
cursor = [S.rect.x - 100, S.rect.y + 60]; flush();
mouseDown = false; flush();
assert.deepStrictEqual([S.rect.x, S.rect.y], [1160, 200], "header drag moves the window");

const [tt, yt, , back, , , close] = header.children.filter(c => c.paneltype === "Button");
const fire = url => events.HTMLURLChanged({}, url, "title");

// own history for "back" (events after the 3 s redirect window are real navigations)
const realNow = Date.now; Date.now = () => realNow() + 10000;
fire("https://www.tiktok.com/@a/video/1");
fire("https://www.tiktok.com/@a/video/1");
fire("https://www.tiktok.com/@b/video/2");
back.events.onactivate();
assert.strictEqual(urls.slice(-1)[0][1], "https://www.tiktok.com/@a/video/1", "back goes to the previous video");

// switching tabs unloads the old page and restores it later
yt.events.onactivate();
assert.strictEqual(lastUrlOf("tiktok"), "about:blank", "hidden tab is unloaded (no audio)");
assert(!root.FindChildTraverse("DDShortsOverlay_tiktok").visible, "hidden tab is not visible");
fire("https://www.youtube.com/shorts/XYZ");
tt.events.onactivate();
assert(/^https:\/\/www\.tiktok\.com\//.test(lastUrlOf("tiktok")), "tab restores its last address");
assert.strictEqual(lastUrlOf("shorts"), "about:blank", "the other tab is unloaded");

// closing unloads everything, the hotkey reopens
close.events.onactivate();
assert(["tiktok", "shorts"].every(id => lastUrlOf(id) === "about:blank"), "closing unloads all pages");
keybinds.key_f8();
assert(win.visible, "hotkey reopens the window");
assert.strictEqual(urls.filter(u => u[1].startsWith("javascript:")).length, 0, "never sends javascript: URLs");

// keyboard focus follows the cursor
win.actuallayoutwidth = 420; win.actuallayoutheight = 780;
cursor = [S.rect.x + 100, S.rect.y + 300]; flush();
assert(focus && focus.id === "DDShortsOverlay_tiktok", "cursor over the window gives keys to the page");
cursor = [5, 5]; flush();
assert.strictEqual(focus, null, "cursor away gives keys back to the game");
cursor = [S.rect.x + 100, S.rect.y + 300]; flush();
close.events.onactivate();
assert.strictEqual(focus, null, "closing gives keys back to the game");

console.log("test_window: OK");
