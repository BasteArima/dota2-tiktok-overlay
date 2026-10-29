"""Minimal VPK v1/v2 reader: list and extract files."""
import struct, sys, os, fnmatch

def read_cstr(f):
    b = bytearray()
    while True:
        c = f.read(1)
        if c in (b'\0', b''):
            return b.decode('utf-8', 'replace')
        b += c

def parse(path):
    entries = []
    with open(path, 'rb') as f:
        sig, ver, tree_size = struct.unpack('<III', f.read(12))
        assert sig == 0x55AA1234, 'not a vpk'
        header = 12
        if ver == 2:
            f.read(16)
            header = 28
        tree_end = header + tree_size
        while True:
            ext = read_cstr(f)
            if not ext: break
            while True:
                d = read_cstr(f)
                if not d: break
                while True:
                    name = read_cstr(f)
                    if not name: break
                    crc, preload, arch, off, length, term = struct.unpack('<IHHIIH', f.read(18))
                    pre = f.read(preload)
                    full = (f"{d}/" if d.strip() != '' else '') + f"{name}.{ext}"
                    entries.append(dict(path=full, arch=arch, off=off, len=length, pre=pre))
    return entries, tree_end

def extract(path, pattern, out):
    entries, tree_end = parse(path)
    base = path[:-len('_dir.vpk')]
    for e in entries:
        if not fnmatch.fnmatch(e['path'], pattern): continue
        data = e['pre']
        if e['len']:
            if e['arch'] == 0x7fff:
                src, off = path, tree_end + e['off']
            else:
                src, off = f"{base}_{e['arch']:03d}.vpk", e['off']
            with open(src, 'rb') as f:
                f.seek(off); data += f.read(e['len'])
        dst = os.path.join(out, e['path'])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'wb') as f: f.write(data)
        print('extracted', e['path'])

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'list':
        pat = sys.argv[3] if len(sys.argv) > 3 else '*'
        for e in parse(sys.argv[2])[0]:
            if fnmatch.fnmatch(e['path'], pat): print(e['path'])
    elif cmd == 'extract':
        extract(sys.argv[2], sys.argv[3], sys.argv[4])
