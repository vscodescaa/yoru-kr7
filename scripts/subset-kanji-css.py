"""Genera src/fonts-ja.css con solo los @font-face de Shippori Mincho B1 que cubren
los caracteres japoneses que usa la demo (fontsource reparte la fuente en ~120 trozos)."""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
texts = [ROOT / 'index.html', *sorted((ROOT / 'src').rglob('*.js'))]
chars = set()
for t in texts:
    chars |= {c for c in t.read_text(encoding='utf-8') if ord(c) > 0x2FFF}

def covers(rng):
    for part in rng.split(','):
        part = part.strip().replace('U+', '')
        if '-' in part:
            a, b = (int(x, 16) for x in part.split('-'))
        else:
            a = b = int(part, 16)
        if any(a <= ord(c) <= b for c in chars):
            return True
    return False

out = ['/* Generado por scripts/subset-kanji-css.py: no editar a mano. */']
for weight in (500, 800):
    css = (ROOT / 'node_modules/@fontsource/shippori-mincho-b1' / f'{weight}.css').read_text(encoding='utf-8')
    for block in re.findall(r'@font-face\s*{[^}]+}', css):
        m = re.search(r'unicode-range:\s*([^;]+);', block)
        if m and covers(m.group(1)):
            block = block.replace('url(./files/', 'url(../node_modules/@fontsource/shippori-mincho-b1/files/')
            block = re.sub(r",\s*url\([^)]+\.woff\)\s*format\('woff'\)", '', block)
            out.append(block)
(ROOT / 'src' / 'fonts-ja.css').write_text('\n'.join(out) + '\n', encoding='utf-8')
print(len(chars), 'caracteres,', len(out) - 1, 'bloques @font-face')
