"""Print ASCII strings from a binary near matches of a regex (context = neighbouring strings)."""
import re, sys
data = open(sys.argv[1], 'rb').read()
pat = re.compile(sys.argv[2])
ctx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
strs = [m.group().decode() for m in re.finditer(rb'[\x20-\x7e]{3,}', data)]
seen = set()
for i, s in enumerate(strs):
    if pat.search(s):
        lo, hi = max(0, i - ctx), min(len(strs), i + ctx + 1)
        if (lo, hi) in seen: continue
        seen.add((lo, hi))
        print(' | '.join(strs[lo:hi]))
