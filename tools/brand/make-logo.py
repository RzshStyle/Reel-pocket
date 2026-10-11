from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
f = TTFont('/usr/share/fonts/opentype/inter/InterDisplay-Black.otf')
gs = f.getGlyphSet(); cmap = f.getBestCmap(); hmtx = f['hmtx']; upm = f['head'].unitsPerEm
def text_path(s, x, base, size, track=0):
    sc = size / upm; pen = SVGPathPen(gs)
    for ch in s:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (sc, 0, 0, -sc, x, base))
        gs[g].draw(tp); x += hmtx[g][0] * sc + track
    return pen.getCommands(), x
H = 108
size = 66
p1, x1 = text_path('Reel', 128, 80, size, -1)
p2, x2 = text_path('Pocket', x1 + 14, 80, size, -1)
W = int(x2 + 6)
icon = '''
<g>
  <rect x="6" y="10" width="104" height="88" rx="18" fill="#d6262f"/>
  <rect x="6" y="10" width="104" height="88" rx="18" fill="none" stroke="#ffc531" stroke-width="6"/>
  <rect x="18" y="24" width="24" height="60" rx="5" fill="#fff7ea"/>
  <rect x="46" y="24" width="24" height="60" rx="5" fill="#fff7ea"/>
  <rect x="74" y="24" width="24" height="60" rx="5" fill="#fff7ea"/>
  <rect x="12" y="51" width="92" height="5" rx="2.5" fill="#ffc531"/>
  <circle cx="26" cy="64" r="5.5" fill="#d6262f"/><circle cx="35" cy="66" r="5.5" fill="#d6262f"/>
  <path d="M26 58 Q30 44 37 40 M35 60 Q34 48 37 40" stroke="#2e7d32" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <text/>
  <path d="M51 38h14l-8 26h-5l7-21h-8z" fill="#d6262f"/>
  <rect x="78" y="44" width="16" height="7" rx="1.5" fill="#1b1b1b"/><rect x="78" y="58" width="16" height="7" rx="1.5" fill="#1b1b1b"/>
</g>'''.replace('<text/>','')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<title>Reel Pocket</title>{icon}
<path fill="#fff7ea" d="{p1}"/>
<path fill="#ffc531" d="{p2}"/>
</svg>'''
open('reel-pocket-logo.svg','w').write(svg)
# square app icon
ic = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="#141012"/>
<g transform="translate(47 61) scale(3.6)">{icon}</g></svg>'''
open('reel-pocket-icon.svg','w').write(ic)
icm = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="#141012"/>
<g transform="translate(126 152) scale(2.2)">{icon}</g></svg>'''
open('reel-pocket-icon-maskable.svg','w').write(icm)
print(W)
