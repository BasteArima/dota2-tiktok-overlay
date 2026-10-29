"""Source 2 resource (_c) block reader."""
import struct, sys

def blocks(buf):
    size, hv, ver, boff, bcount = struct.unpack_from('<IHHII', buf, 0)
    out = []
    base = 8 + boff
    for i in range(bcount):
        p = base + i * 12
        typ = buf[p:p+4].decode()
        off, ln = struct.unpack_from('<II', buf, p + 4)
        out.append((typ, p + 4 + off, ln, p))
    return dict(size=size, hv=hv, ver=ver, blocks=out)

if __name__ == '__main__':
    buf = open(sys.argv[1], 'rb').read()
    info = blocks(buf)
    print(f"filesize={info['size']} actual={len(buf)} hv={info['hv']} ver={info['ver']}")
    for typ, off, ln, p in info['blocks']:
        print(f"  {typ} off={off:#x} len={ln:#x} end={off+ln:#x}")
    if len(sys.argv) > 2:
        want = sys.argv[2]
        for typ, off, ln, p in info['blocks']:
            if typ == want:
                sys.stdout.buffer.write(buf[off:off+ln])
