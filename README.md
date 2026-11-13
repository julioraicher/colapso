# COLAPSO

FPS de conquista 8v8 contra bots, em um instituto de pesquisa sob tempestade noturna. Mundo voxel **100% destrutível** com colapso estrutural, gunplay pesado e duas mecânicas inspiradas em mecânica quântica. Roda em PC sem placa de vídeo dedicada.

## ⬇️ Baixar e jogar

**[Baixar para Windows (.zip)](https://github.com/julioraicher/colapso/releases/latest/download/Colapso-windows.zip)** → extrair → `Colapso.exe`.

Sem instalar: [versão navegador](https://github.com/julioraicher/colapso/releases/latest/download/Colapso-navegador.zip) → extrair → abrir `index.html`.

## A mecânica: dualidade onda-partícula como arma

| Tecla | Habilidade | Física por trás |
|---|---|---|
| **Q** | **Tunelamento** — atravessa a parede à sua frente | Barreira retangular, aproximação WKB: transmissão `T = e^(−2κd)`, κ = 0,42 m⁻¹. Custo de energia = 22/T. Parede de 0,5 m custa ~34; de 1,5 m, ~78; acima de ~1,8 m é impossível. O HUD mostra `d`, `T` e o custo em tempo real. |
| **E** | **Superposição** — cria um eco seu que avança e atira | O estado vira \|você⟩ + \|eco⟩: os bots não distinguem os dois. Apertar E de novo **colapsa** a função de onda no eco (você se teletransporta). Se o eco morrer: *decoerência*, energia perdida. |

As duas conversam com a destruição: explodir uma parede grossa a deixa fina o bastante para tunelar; o eco atrai fogo inimigo que destrói a cobertura dos próprios inimigos.

## O que tem dentro

- **Mundo voxel 192×48×192 (0,5 m)**, malha por chunks com AO por vértice, sombras da lua por *ray-march* e **luz colorida neon propagada por BFS** (canal RGB, atenuação exponencial), tudo pré-calculado no vértice: o custo em GPU é de um `MeshBasicMaterial`.
- **Destruição**: tiros desgastam voxels (HP por material: vidro 1, madeira 2, concreto 6, metal 40); granadas abrem crateras; **integridade estrutural** por *flood fill* derruba o que fica sem apoio (e esmaga quem estiver embaixo). Navegação dos bots é recalculada na hora.
- **Gunplay**: 4 primárias (K-7, Vespa, Martelo 12, Lança DMR) + pistola. Recuo vertical com recuperação parcial, *bloom*, queda de dano por distância, multiplicador de cabeça, ADS com FOV por arma e luneta.
- **Áudio 100% procedural** (WebAudio): tiros = estalo supersônico + blast + *thump*; propagação com **atraso c = 343 m/s**, absorção do ar (passa-baixa ∝ distância), lei do inverso da distância, reverb por resposta ao impulso sintética. Trovões chegam atrasados conforme a distância do relâmpago.
- **Bots**: A* em grade 2,5D, percepção com linha de visada, tempo de reação, erro de mira que converge, rajadas, *strafe*, agachar, granadas balísticas contra quem se esconde, objetivo de conquista, *rubber-band* de dificuldade.
- **Conquista**: 3 bandeiras (Laboratório, Reator, Hangar), 300 tickets, sangria de tickets por domínio, tela de implantação com escolha de arma e ponto de spawn, minimapa, killfeed, placar.
- **Leve**: ~200 draw calls, sem texturas, resolução adaptativa automática (mantém ~60 FPS em GPU integrada), opção de qualidade baixa.

## Desenvolvimento

```bash
npm ci
npm run build          # dist/index.html + dist/game.js
npm test               # playtest automatizado (piloto IA joga uma partida, coleta métricas e screenshots)
node test/balance.cjs  # bots vs bots, simetria de times
npm run package        # out/Colapso-windows.zip (Electron win32-x64)
```

Push de uma tag `v*` dispara o GitHub Actions que empacota e publica a release.

Estrutura: `src/world.js` (voxels, luz, destruição, raycast DDA), `src/mapgen.js` (mapa procedural), `src/player.js`, `src/weapons.js`, `src/ai.js`, `src/abilities.js`, `src/audio.js`, `src/fx.js`, `src/hud.js`, `src/main.js`.

Tudo é procedural ou código próprio; única dependência de runtime: [three.js](https://threejs.org) (MIT).
