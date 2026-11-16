# Desenha o cursor do site (mão pixelada, contorno preto e miolo branco, fundo transparente).
# Gera assets/cursor.png (2 px por pixel do desenho, 30x32) e assets/cursor@2x.png (telas retina).
# Ponta do dedo (hotspot do CSS): x 17, y 1 no cursor.png.
# Uso: python ferramentas/cursor.py
from PIL import Image

W, H = 15, 16
# Contorno: (coluna inicial, coluna final, linha inicial, linha final), inclusive.
PRETO = [
    (8, 9, 0, 0), (7, 7, 1, 6), (10, 10, 1, 6),            # dedo do meio
    (5, 7, 4, 4), (11, 11, 4, 4), (4, 4, 5, 8),            # base dos dedos dos lados
    (12, 13, 5, 5), (12, 12, 6, 6), (14, 14, 6, 10),       # anelar e mínimo
    (1, 2, 6, 6), (0, 0, 7, 8), (3, 4, 7, 7),              # polegar
    (1, 1, 9, 9), (2, 2, 10, 11), (3, 3, 12, 12), (4, 4, 13, 13), (5, 5, 14, 15),   # lado esquerdo
    (6, 9, 15, 15), (10, 10, 14, 14), (11, 12, 15, 15), (12, 12, 13, 14), (13, 13, 11, 12),   # base
    (7, 7, 9, 12), (9, 9, 9, 12), (11, 11, 9, 12),         # dobras dos dedos
]

g = [[0] * W for _ in range(H)]
for x0, x1, y0, y1 in PRETO:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = 1

# Fora da mão: tudo que se alcança pela borda sem cruzar o contorno. O resto é miolo branco.
fora = [[False] * W for _ in range(H)]
pilha = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
while pilha:
    x, y = pilha.pop()
    if not (0 <= x < W and 0 <= y < H) or fora[y][x] or g[y][x]:
        continue
    fora[y][x] = True
    pilha += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for y in range(H):
    for x in range(W):
        if g[y][x]:
            img.putpixel((x, y), (35, 31, 32, 255))
        elif not fora[y][x]:
            img.putpixel((x, y), (255, 255, 255, 255))

img.resize((W * 2, H * 2), Image.NEAREST).save('assets/cursor.png')
img.resize((W * 4, H * 4), Image.NEAREST).save('assets/cursor@2x.png')
img.resize((W * 16, H * 16), Image.NEAREST).save(__import__('sys').argv[1] if len(__import__('sys').argv) > 1 else 'assets/cursor-preview.png')
print('ok')
