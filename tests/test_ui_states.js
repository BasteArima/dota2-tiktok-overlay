// Main menu + match HUD windows sharing GameUI.CustomUIConfig, driven through DOTAGameUIStateChanged.
// Usage: node tests/test_ui_states.js <overlay.js with config substituted>   (tests/run_tests.py does this)
const assert = require("assert");
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");

let scheduled = [];
const keybinds = {};   // key -> callbacks from every window
const uiHandlers = [];
const urls = [];
function Panel(type, parent, id) {
    this.paneltype = type; this.id = id || ""; this.children = []; this.parent = parent; this.style = {};
    this.visible = true; this.valid = true; this.events = {};
    this.actuallayoutwidth = 1920; this.actuallayoutheight = 1080; this.actualuiscale_y = 1;
    if (parent) parent.children.push(this);
}
Panel.prototype.GetParent = function () { return this.parent; };
Panel.prototype.IsValid = function () { return this.valid; };
Panel.prototype.FindChild = function (id) { return this.children.find(c => c.id === id) || null; };
Panel.prototype.FindChildTraverse = function (id) {
    for (const c of this.children) { if (c.id === id) return c; const r = c.FindChildTraverse(id); if (r) return r; }
    return null;
};
Panel.prototype.GetChildCount = function () { return this.children.length; };
Panel.prototype.GetChild = function (i) { return this.children[i]; };
Panel.prototype.MoveChildAfter = function (c, after) {
    this.children.splice(this.children.indexOf(c), 1);
    this.children.splice(this.children.indexOf(after) + 1, 0, c);
};
Panel.prototype.SetFocus = function () {};
Panel.prototype.SetPanelEvent = function (n, f) { this.events[n] = f; };
Panel.prototype.SetURL = function (u) { urls.push([this.id, u]); };
Panel.prototype.GetPositionWithinWindow = function () { return { x: 0, y: 0 }; };
const invalidate = p => { p.valid = false; p.children.forEach(invalidate); };

let currentCtx = null;
const shared = {};
global.$ = {
    Msg: () => {},
    GetContextPanel: () => currentCtx,
    Schedule: (t, f) => { const c = currentCtx; scheduled.push(() => { currentCtx = c; f(); }); },
    CreatePanel: (type, parent, id, props) => { const p = new Panel(type, parent, id); Object.assign(p, props || {}); return p; },
    DispatchEvent: () => {},
    RegisterKeyBind: (n, key, cb) => (keybinds[key] = keybinds[key] || []).push(cb),
    RegisterEventHandler: () => {},
    RegisterForUnhandledEvent: (n, cb) => { if (n === "DOTAGameUIStateChanged") uiHandlers.push(cb); },
};
global.GameUI = { CustomUIConfig: () => shared, IsMouseDown: () => false, GetCursorPosition: () => [0, 0] };
const flush = () => { const s = scheduled; scheduled = []; s.forEach(f => f()); };
function makeWindow(ctxType) {
    const root = new Panel("Panel", null, "root_" + ctxType);
    currentCtx = new Panel(ctxType, root, "ctx");
    eval(src);
    flush();
    return root;
}
const LOADING = 1, INGAME = 2, DASHBOARD = 3;
const uiState = s => uiHandlers.forEach(h => h(0, s));
let offset = 0; const realNow = Date.now; Date.now = () => realNow() + offset;
const press = () => { offset += 1000; keybinds.key_f8.forEach(cb => cb()); };  // one key press reaches every window
const win = root => root.FindChild("DDShortsOverlay").children[0];
const lastUrl = () => urls.slice(-1)[0][1];

const menu = makeWindow("DOTAPlay");
press();
assert(win(menu).visible, "hotkey opens the menu window");

new Panel("Panel", menu, "PostGameLayer");  // the game adds a panel to the menu root later
uiState(LOADING);
assert(!win(menu).visible, "loading screen closes the window");
assert.strictEqual(lastUrl(), "about:blank", "loading screen unloads the page (no audio)");

uiState(INGAME);
const hud = makeWindow("DOTAHud");
assert(win(hud).visible, "the window continues in the match HUD");
assert(!win(menu).visible, "the menu window stays closed in a match");
press();
assert(!win(hud).visible, "hotkey in a match toggles the HUD window");
press();

uiState(DASHBOARD);  // main menu opened over a running match
assert(win(menu).visible && !win(hud).visible, "the open window moves to the menu");
assert.strictEqual(menu.children.slice(-1)[0].id, "DDShortsOverlay", "overlay is raised above later panels");
uiState(INGAME);
assert(win(hud).visible, "and back to the match");

uiState(DASHBOARD);  // leaving the match
invalidate(hud);
assert(win(menu).visible, "after the match the window is in the menu");
press();
assert(!win(menu).visible, "hotkey toggles the menu window after the match");
press();
assert(win(menu).visible, "and opens it again");
assert.strictEqual(urls.filter(u => u[1].startsWith("javascript:")).length, 0, "never sends javascript: URLs");

console.log("test_ui_states: OK");
