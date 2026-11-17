"""Ícone da aba (favicon): o "N" cromado do logo (1º quadro de assets/logo.gif, de frente) num
quadrado preto de cantos arredondados, para aparecer tanto na aba clara quanto na escura.
Gera assets/favicon.ico (16, 32, 48), assets/favicon-32.png, assets/favicon-192.png e
assets/apple-touch-icon.png (180). Rode da raiz do site: python ferramentas/favicon.py"""
from PIL import Image, ImageDraw

gif = Image.open('assets/logo.gif')
gif.seek(0)
quadro = gif.convert('RGBA')
quadro = quadro.crop(quadro.getchannel('A').getbbox())
# Só o "N" (com o floreio): no logo ele encosta no "i", então corta a direita de baixo e fica só
# com a maior mancha (some o pingo que sobrar do "i").
n = quadro.crop((0, 0, 104, quadro.height)).copy()
px = n.load()
for y in range(n.height):
    for x in range(n.width):
        if x > 84 and y > 0.35 * n.height:
            px[x, y] = (0, 0, 0, 0)
vis, manchas = set(), []
for y0 in range(n.height):
    for x0 in range(n.width):
        if (x0, y0) in vis or px[x0, y0][3] < 40:
            continue
        pilha, mancha = [(x0, y0)], []
        vis.add((x0, y0))
        while pilha:
            x, y = pilha.pop()
            mancha.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if 0 <= q[0] < n.width and 0 <= q[1] < n.height and q not in vis and px[q][3] >= 40:
                        vis.add(q)
                        pilha.append(q)
        manchas.append(mancha)
maior = max(manchas, key=len)
for m in manchas:
    if m is not maior and len(m) < 0.05 * len(maior):
        for x, y in m:
            px[x, y] = (0, 0, 0, 0)
n = n.crop(n.getchannel('A').getbbox())


def icone(lado, margem=0.07, raio=0.22, fundo=(17, 17, 17, 255)):
    escala = 4                                          # desenha grande e reduz: bordas suaves
    L = lado * escala
    img = Image.new('RGBA', (L, L), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, L - 1, L - 1), radius=int(L * raio), fill=fundo)
    caixa = L * (1 - 2 * margem)
    f = min(caixa / n.width, caixa / n.height)
    letra = n.resize((round(n.width * f), round(n.height * f)), Image.LANCZOS)
    img.alpha_composite(letra, ((L - letra.width) // 2, (L - letra.height) // 2))
    return img.resize((lado, lado), Image.LANCZOS)


icone(48).save('assets/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
icone(32).save('assets/favicon-32.png')
icone(192).save('assets/favicon-192.png')
icone(180, raio=0).save('assets/apple-touch-icon.png')  # o iPhone arredonda sozinho
print('ok', n.size)
