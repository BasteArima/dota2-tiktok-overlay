"""Build and install the Dota 2 TikTok overlay mod.

Takes the current Panorama scripts from the game's pak01, appends overlay.js to them,
re-packs the compiled resources and writes a VPK into the mod folder used by the mod manager.
Re-run after every Dota update.

    python build.py                      build + install (game and mod folder are detected automatically)
    python build.py --key f9             same, with a different default hotkey (saved to config.json)
    python build.py --mod-dir dota_xxx   install into a specific folder under game/
    python build.py --uninstall          remove the installed VPK
"""
import argparse, glob, json, os, re, shutil, struct, sys, zlib

DOTA_SUBPATH = os.path.join("steamapps", "common", "dota 2 beta", "game")
DEFAULT_MOD_DIR = "dota_tempcontent"  # used with the launch option -language tempcontent
VPK_NAME = "pak88_dir.vpk"            # a number mod managers don't use

# script -> where it runs
TARGETS = {
    "panorama/scripts/play.vts_c": "main menu (dashboard)",
    "panorama/scripts/hud/hud_reborn.vjs_c": "in-game HUD incl. hero pick",
}

FROZEN = getattr(sys, "frozen", False)  # running as the PyInstaller .exe
# overlay.js and the default config.json: bundled inside the .exe, or next to this script
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
# user-editable config.json and the build/ output: next to the .exe, or next to this script
HERE = os.path.dirname(os.path.abspath(sys.executable if FROZEN else __file__))


# ---------- VPK ----------

def _cstr(f):
    b = bytearray()
    while (c := f.read(1)) not in (b"\0", b""):
        b += c
    return b.decode("utf-8", "replace")

def vpk_read_file(dir_path, wanted):
    """Return bytes of one file from a multi-archive VPK."""
    with open(dir_path, "rb") as f:
        sig, ver, tree_size = struct.unpack("<III", f.read(12))
        if sig != 0x55AA1234:
            raise ValueError(f"{dir_path}: not a VPK")
        header = 28 if ver == 2 else 12
        f.seek(header)
        while ext := _cstr(f):
            while d := _cstr(f):
                while name := _cstr(f):
                    crc, pre_len, arch, off, length, _ = struct.unpack("<IHHIIH", f.read(18))
                    pre = f.read(pre_len)
                    path = (f"{d}/" if d.strip() else "") + f"{name}.{ext}"
                    if path != wanted:
                        continue
                    if arch == 0x7FFF:
                        src, off = dir_path, header + tree_size + off
                    else:
                        src = f"{dir_path[:-len('_dir.vpk')]}_{arch:03d}.vpk"
                    with open(src, "rb") as a:
                        a.seek(off)
                        return pre + a.read(length)
    raise FileNotFoundError(wanted)

def vpk_write(out_path, files):
    """Write a single-file VPK v2 with all data embedded in the _dir file."""
    tree = {}
    for path, data in files.items():
        d, _, fname = path.rpartition("/")
        name, _, ext = fname.rpartition(".")
        tree.setdefault(ext, {}).setdefault(d or " ", []).append((name, data))
    t, blob = bytearray(), bytearray()
    for ext, dirs in tree.items():
        t += ext.encode() + b"\0"
        for d, entries in dirs.items():
            t += d.encode() + b"\0"
            for name, data in entries:
                t += name.encode() + b"\0"
                t += struct.pack("<IHHIIH", zlib.crc32(data), 0, 0x7FFF, len(blob), len(data), 0xFFFF)
                blob += data
            t += b"\0"
        t += b"\0"
    t += b"\0"
    with open(out_path, "wb") as f:
        f.write(struct.pack("<IIIIIII", 0x55AA1234, 2, len(t), len(blob), 0, 0, 0))
        f.write(t)
        f.write(blob)


# ---------- Source 2 resource (_c) ----------

def resource_replace_data(buf, transform):
    """Replace the DATA block of a compiled resource, shifting any blocks stored after it."""
    _, _, _, boff, count = struct.unpack_from("<IHHII", buf, 0)
    table = 8 + boff
    blocks = []
    for i in range(count):
        p = table + i * 12
        rel, size = struct.unpack_from("<II", buf, p + 4)
        blocks.append([buf[p:p + 4], p, p + 4 + rel, size])
    data_blk = next(b for b in blocks if b[0] == b"DATA")
    if any(b[2] > data_blk[2] and b[2] < data_blk[2] + data_blk[3] for b in blocks):
        raise ValueError("unexpected block overlap")

    out = bytearray(buf[:data_blk[2]])
    new_data = transform(bytes(buf[data_blk[2]:data_blk[2] + data_blk[3]]))
    out += new_data
    struct.pack_into("<I", out, data_blk[1] + 8, len(new_data))
    for b in sorted(blocks, key=lambda b: b[2]):
        if b[2] <= data_blk[2]:
            continue
        out += b"\0" * (-len(out) % 16)
        struct.pack_into("<I", out, b[1] + 4, len(out) - (b[1] + 4))
        out += buf[b[2]:b[2] + b[3]]
    struct.pack_into("<I", out, 0, len(out))
    return bytes(out)

def append_js(extra):
    def transform(data):
        nul = data.endswith(b"\0")
        body = data.rstrip(b"\0")
        return body + b"\n" + extra + (b"\0" if nul else b"")
    return transform


# ---------- locating the game ----------

def steam_libraries():
    roots = []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            roots.append(winreg.QueryValueEx(k, "SteamPath")[0])
    except OSError:
        pass
    roots += [os.path.expanduser("~/.steam/steam"), os.path.expanduser("~/.local/share/Steam"),
              r"C:\Program Files (x86)\Steam"]
    libs = []
    for root in roots:
        vdf = os.path.join(root, "steamapps", "libraryfolders.vdf")
        if os.path.exists(vdf):
            with open(vdf, encoding="utf-8", errors="replace") as f:
                libs += [p.replace("\\\\", "\\") for p in re.findall(r'"path"\s+"([^"]+)"', f.read())]
        libs.append(root)
    return libs

def find_game_dir(arg):
    candidates = [arg] if arg else [os.path.join(lib, DOTA_SUBPATH) for lib in steam_libraries()]
    for c in candidates:
        if os.path.exists(os.path.join(c, "dota", "pak01_dir.vpk")):
            return os.path.normpath(c)
    raise SystemExit("Dota 2 not found. Pass the path to the game folder: "
                     'python build.py --game "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game"')

def find_mod_dir(game, arg):
    if arg:
        return arg
    # a folder set up by Dota 2 Mod Manager (it marks it with dota2modmanager.json)
    managed = glob.glob(os.path.join(game, "dota_*", "dota2modmanager.json"))
    if managed:
        return os.path.basename(os.path.dirname(managed[0]))
    return DEFAULT_MOD_DIR


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", help="path to '<steam library>/steamapps/common/dota 2 beta/game'")
    ap.add_argument("--mod-dir", help="mod folder under game/ (default: mod manager's folder or dota_tempcontent)")
    ap.add_argument("--key", help="default hotkey, e.g. f9, insert, pageup")
    ap.add_argument("--uninstall", action="store_true")
    args = ap.parse_args()

    game = find_game_dir(args.game)
    mod_dir = find_mod_dir(game, args.mod_dir)
    install_path = os.path.join(game, mod_dir, VPK_NAME)
    print("game:", game)
    print("mod folder:", mod_dir)
    if args.uninstall:
        if os.path.exists(install_path):
            os.remove(install_path)
            print("removed", install_path)
        else:
            print("not installed")
        return

    config_path = os.path.join(HERE, "config.json")
    source = config_path if os.path.exists(config_path) else os.path.join(RES_DIR, "config.json")
    with open(source, encoding="utf-8") as f:
        config = json.load(f)
    if args.key:
        config["hotkey"] = args.key.lower().removeprefix("key_")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    with open(os.path.join(RES_DIR, "overlay.js"), encoding="utf-8") as f:
        overlay = f.read()
    if "__DD_CONFIG__" not in overlay:
        raise SystemExit("overlay.js: __DD_CONFIG__ placeholder missing")
    overlay = overlay.replace("__DD_CONFIG__", json.dumps(config, ensure_ascii=False)).encode("utf-8")
    print("hotkey:", config["hotkey"])
    pak01 = os.path.join(game, "dota", "pak01_dir.vpk")

    files = {}
    for path, where in TARGETS.items():
        original = vpk_read_file(pak01, path)
        files[path] = resource_replace_data(original, append_js(overlay))
        print(f"patched {path} ({where}): {len(original)} -> {len(files[path])} bytes")

    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    out = os.path.join(HERE, "build", VPK_NAME)
    vpk_write(out, files)
    os.makedirs(os.path.dirname(install_path), exist_ok=True)
    try:
        shutil.copyfile(out, install_path)
    except PermissionError:
        raise SystemExit(f"Cannot write {install_path}: close Dota 2 and run again.")
    print("installed", install_path)
    if mod_dir == DEFAULT_MOD_DIR:
        print("\nAdd the Steam launch option for Dota 2 so the game loads this folder:  -language tempcontent")


if __name__ == "__main__":
    try:
        code = main()
    except SystemExit as e:
        code = e.code
        if isinstance(code, str):
            print(code, file=sys.stderr)
            code = 1
    if FROZEN and len(sys.argv) == 1:
        # started by double-click: keep the console window open to show the result
        input("\nPress Enter to close / Нажми Enter, чтобы закрыть")
    sys.exit(code)
