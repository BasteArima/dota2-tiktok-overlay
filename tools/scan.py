"""Scan all layouts in pak01 and report which scripts each references."""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from vpk import parse
from res import blocks
from kvstr import best

pak = sys.argv[1]
entries, tree_end = parse(pak)
base = pak[:-len('_dir.vpk')]
handles = {}
def read(e):
    data = e['pre']
    if e['len']:
        if e['arch'] == 0x7fff:
            src, off = pak, tree_end + e['off']
        else:
            src, off = f"{base}_{e['arch']:03d}.vpk", e['off']
        f = handles.get(src) or handles.setdefault(src, open(src, 'rb'))
        f.seek(off); data += f.read(e['len'])
    return data

for e in entries:
    p = e['path']
    if not (p.startswith('panorama/layout/') and p.endswith('.vxml_c')): continue
    try:
        buf = read(e)
        for typ, off, ln, _ in blocks(buf)['blocks']:
            if typ == 'LaCo':
                d = best(buf[off:off+ln])
                refs = sorted(set(m.decode() for m in re.findall(rb'panorama/scripts/[\w/.-]+', d)))
                inc = sorted(set(m.decode() for m in re.findall(rb'panorama/layout/[\w/.-]+\.vxml', d)))
                print(p, '|', ' '.join(refs), '|', ' '.join(inc))
    except Exception as ex:
        print(p, '| ERROR', ex)
