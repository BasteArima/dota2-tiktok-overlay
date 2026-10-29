"""Brute-force LZ4-decompress KV3 blocks inside a resource file and print strings."""
import sys, re, struct
sys.path.insert(0, __import__('os').path.dirname(__file__))
from res import blocks

def lz4_block(src, start, limit=1 << 22):
    dst = bytearray(); i = start; n = len(src)
    while i < n:
        tok = src[i]; i += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                b = src[i]; i += 1; lit += b
                if b != 255: break
        if i + lit > n: raise ValueError
        dst += src[i:i+lit]; i += lit
        if i >= n: break
        off = src[i] | (src[i+1] << 8); i += 2
        if off == 0 or off > len(dst): raise ValueError
        ml = tok & 15
        if ml == 15:
            while True:
                b = src[i]; i += 1; ml += b
                if b != 255: break
        ml += 4
        for _ in range(ml): dst.append(dst[-off])
        if len(dst) > limit: raise ValueError
    return bytes(dst)

def best(chunk):
    # KV3 v5: two LZ4 buffers; compressed sizes at 0x4c and 0x54, data starts at 0x78
    c1 = struct.unpack_from('<I', chunk, 0x4c)[0]
    c2 = struct.unpack_from('<I', chunk, 0x54)[0]
    s = 0x78
    return lz4_block(chunk[:s + c1], s) + b'\n' + lz4_block(chunk[:s + c1 + c2], s + c1)

if __name__ == '__main__':
    buf = open(sys.argv[1], 'rb').read()
    want = sys.argv[2] if len(sys.argv) > 2 else 'LaCo'
    for typ, off, ln, p in blocks(buf)['blocks']:
        if typ != want: continue
        d = best(buf[off:off+ln])
        for m in re.findall(rb'[\x20-\x7e]{4,}', d):
            print(m.decode())
