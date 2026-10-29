"""grep decompressed strings of all layouts (and optionally scripts) in pak01 for a regex."""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from vpk import parse
from res import blocks
from kvstr import best

pak, pattern = sys.argv[1], re.compile(sys.argv[2].encode())
ctx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
entries, tree_end = parse(pak)
base = pak[:-len('_dir.vpk')]
handles = {}
def read(e):
    data = e['pre']
    if e['len']:
        src, off = (pak, tree_end + e['off']) if e['arch'] == 0x7fff else (f"{base}_{e['arch']:03d}.vpk", e['off'])
        f = handles.get(src) or handles.setdefault(src, open(src, 'rb'))
        f.seek(off); data += f.read(e['len'])
    return data

for e in entries:
    p = e['path']
    if not p.startswith('panorama/'): continue
    try:
        buf = read(e)
        if p.endswith('.vxml_c'):
            text = b''
            for typ, off, ln, _ in blocks(buf)['blocks']:
                if typ == 'LaCo': text = best(buf[off:off+ln])
            strs = re.findall(rb'[\x20-\x7e]{3,}', text)
        elif p.endswith(('.vjs_c', '.vts_c')):
            text = b''
            for typ, off, ln, _ in blocks(buf)['blocks']:
                if typ == 'DATA': text = buf[off:off+ln]
            strs = text.split(b'\n')
        else:
            continue
        for i, s in enumerate(strs):
            if pattern.search(s):
                lo, hi = max(0, i - ctx), i + ctx + 1
                print(p, '::', ' || '.join(x.decode('utf-8', 'replace').strip() for x in strs[lo:hi]))
    except Exception as ex:
        pass
