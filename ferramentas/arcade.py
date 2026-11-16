# Desenha o arcade pixelado da home (assets/arcade.png): 2 quadros lado a lado, 1 px = 1 pixel
# do desenho. O CSS amplia sem suavizar e alterna os quadros (luzes do letreiro e tela piscando).
# Uso: python ferramentas/arcade.py
from PIL import Image

PAL = {
    '.': None,
    'K': (20, 18, 31),      # contorno
    'B': (59, 47, 143),     # gabinete
    'b': (40, 31, 104),     # sombra do gabinete
    'L': (92, 78, 200),     # luz do gabinete
    'M': (242, 169, 59),    # letreiro
    'm': (201, 101, 31),    # sombra do letreiro
    'W': (255, 247, 214),   # lâmpada acesa
    'w': (166, 92, 34),     # lâmpada apagada
    'S': (16, 26, 92),      # tela
    's': (42, 63, 174),     # brilho da borda da tela
    'T': (255, 255, 255),   # camiseta na tela
    'P': (36, 28, 92),      # painel
    'p': (58, 47, 140),     # borda do painel
    'R': (232, 65, 79),     # bola do joystick
    'r': (150, 30, 44),
    'G': (138, 135, 168),   # haste
    'Y': (255, 210, 63),    # botão amarelo
    'C': (62, 164, 244),    # botão azul
    'O': (255, 138, 42),    # moedeiro aceso
}

def body(screen):
    rows = [
        '..KKKKKKKKKKKKKKKKKKKK..',
        '..KMMMMMMMMMMMMMMMMMMK..',
        '..KM{L}MK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '..KKKKKKKKKKKKKKKKKKKK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBKKKKKKKKKKKKKKBbK..',
    ]
    for r in screen:
        rows.append('..KLBK' + r + 'KBbK..')
    rows += [
        '..KLBKKKKKKKKKKKKKKBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        'KKKKKKKKKKKKKKKKKKKKKKKK',
        'KpppppppppppppppppppppbK',
        'KPPKRRKPPPPPPPPPPPPPPPPK',
        'KPKRRRRKPPPPPPPYYPPCCPPK',
        'KPKRrrRKPPPPPPPYYPPCCPPK',
        'KPPKGGKPPPPPPPPPPPPPPPPK',
        'KKKKKKKKKKKKKKKKKKKKKKKK',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBKKKKBBKKKKBBBbK..',
        '..KLBBBKOOKBBKOOKBBBbK..',
        '..KLBBBKOOKBBKOOKBBBbK..',
        '..KLBBBKKKKBBKKKKBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLBBBBBBBBBBBBBBBBbK..',
        '..KLbbbbbbbbbbbbbbbbbK..',
        '.KKKKKKKKKKKKKKKKKKKKKK.',
        '.KbbbbbbbbbbbbbbbbbbbbK.',
        '.KKKKKKKKKKKKKKKKKKKKKK.',
    ]
    return rows

# Tela 12x10 com uma camiseta; no quadro 2 ela sobe 1 px e a borda brilha mais.
TEE = ['TTT..TTT', 'TTTTTTTT', 'TTTTTTTT', '.TTTTTT.', '.TTTTTT.', '.TTTTTT.']
def screen(dy, edge):
    g = [['S'] * 12 for _ in range(10)]
    for x in range(12): g[0][x] = g[9][x] = edge
    for y in range(10): g[y][0] = g[y][11] = edge
    for y, r in enumerate(TEE):
        for x, c in enumerate(r):
            if c == 'T': g[2 + y + dy][2 + x] = 'T'
    return [''.join(r) for r in g]

def lights(on):
    return ''.join(('W' if (i % 2 == on) else 'w') for i in range(16))

frames = []
for k in (0, 1):
    rows = body(screen(0 if k == 0 else -1, 's' if k == 0 else 'C'))
    rows[2] = '..KM' + lights(k) + 'MK..'
    frames.append(rows)

W, H = 24, len(frames[0])
for f in frames:
    assert all(len(r) == W for r in f), [len(r) for r in f]
img = Image.new('RGBA', (W * 2, H), (0, 0, 0, 0))
for k, f in enumerate(frames):
    for y, r in enumerate(f):
        for x, c in enumerate(r):
            if PAL[c]: img.putpixel((k * W + x, y), PAL[c] + (255,))
img.save('assets/arcade.png')
img.resize((W * 2 * 8, H * 8), Image.NEAREST).save(__import__('sys').argv[1] if len(__import__('sys').argv) > 1 else 'assets/arcade-preview.png')
print(W, H)
