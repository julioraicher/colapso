# COLAPSO

FPS de conquista 8v8 contra bots, em um instituto de pesquisa sob tempestade noturna. Mundo voxel **100% destrutível** com colapso estrutural, gunplay pesado e duas mecânicas inspiradas em mecânica quântica. Roda em PC sem placa de vídeo dedicada.

## ⬇️ Baixar e jogar

**[Baixar para Windows (.zip)](https://github.com/julioraicher/colapso/releases/latest/download/Colapso-windows.zip)** → extrair → `Colapso.exe`.

Jogar direto no navegador: **https://julioraicher.github.io/colapso/** (se o GitHub Pages estiver ativo no repositório).

Sem instalar, offline: [versão navegador](https://github.com/julioraicher/colapso/releases/latest/download/Colapso-navegador.zip) → extrair → abrir `index.html`.

Todas as versões: [Releases](https://github.com/julioraicher/colapso/releases).

### Controles

| Tecla | Ação | Tecla | Ação |
|---|---|---|---|
| WASD · ESPAÇO | mover · pular | SHIFT | correr / **segurar o fôlego** na luneta |
| CTRL | agachar (correndo = deslizar) | Mouse E / D | atirar / mirar |
| R | recarregar | 1 / 2 / roda | primária / secundária |
| **F** ou 3 | gadget da classe | G | granada |
| **Q** | tunelamento | **E** | superposição / colapsar |
| Z ou T | marcar inimigo (spot) | TAB | placar |
| P | mostrar FPS | ESC | pausa |
| **H** ou F1 | todos os controles (teclado e mouse desenhados) | **M** | mapa tático |
| B | inspecionar a arma | **V** | faca (letal pelas costas, quebra vidro) |

Na tela de implantação: 1–4 escolhe a classe, ESPAÇO/ENTER entra em combate.

## A mecânica: dualidade onda-partícula como arma

| Tecla | Habilidade | Física por trás |
|---|---|---|
| **Q** | **Tunelamento** — atravessa a parede à sua frente | Barreira retangular, aproximação WKB: transmissão `T = e^(−2κd)`, κ = 0,42 m⁻¹. Custo de energia = 22/T. Parede de 0,5 m custa ~34; de 1,5 m, ~78; acima de ~1,8 m é impossível. O HUD mostra `d`, `T` e o custo em tempo real. |
| **E** | **Superposição** — cria um eco seu que avança e atira | O estado vira \|você⟩ + \|eco⟩: os bots não distinguem os dois. Apertar E de novo **colapsa** a função de onda no eco (você se teletransporta). Se o eco morrer: *decoerência*, energia perdida. |

As duas conversam com a destruição: explodir uma parede grossa a deixa fina o bastante para tunelar; o eco atrai fogo inimigo que destrói a cobertura dos próprios inimigos.

## O que tem dentro

- **Mundo voxel 192×48×192 (0,5 m)**, malha por chunks com AO por vértice, sombras da lua por *ray-march* e **luz colorida neon propagada por BFS** (canal RGB, atenuação exponencial), tudo pré-calculado no vértice: o custo em GPU é de um `MeshBasicMaterial`.
- **Destruição**: tiros desgastam voxels (HP por material: vidro 1, madeira 2, concreto 6, metal 40); granadas abrem crateras; **integridade estrutural** por *flood fill* derruba o que fica sem apoio (e esmaga quem estiver embaixo). Navegação dos bots é recalculada na hora.
- **Visual pixel-art detalhado (v3)**: um kit próprio de modelagem (`src/kit.js`) gera um atlas 256×256 de *tiles* 16×16 (metal, polímero, madeira, camuflagem digital e *splinter*, MOLLE, trilhos, decalques) e monta cada modelo em **uma única malha**. Com ele:
  - **14 armas com modelo único** (carabina com holográfica, bullpup cinza e teal, SMG com coronha dobrável, PDW com carregador translúcido, escopeta de madeira com porta-cartuchos, LMG de cinto, LMG de tambor, DMR, sniper de ferrolho, rifle de caça, pistola, revólver, pistola automática, RPG), **mãos com luvas e dedos** em primeira pessoa, mira alinhada no centro, cápsulas ejetadas, clarão de boca por arma, ciclo de ferrolho e de bomba, inspeção (B).
  - **Soldados com esqueleto de 17 ossos** e *skinning* rígido: duas facções distinguíveis de longe (KAPPA azul-marinho com luzes ciano, ÔMEGA areia/oliva com luzes laranja), kit por classe visível pelas costas (mochila médica, tubo de foguete, mochila de munição, capuz *ghillie*), variação por semente (altura, pele, capacete, rosto), marcha conforme a velocidade real, mira com **IK analítica de dois ossos**, recuo, recarga e cinco mortes diferentes.
- **HUD com as teclas na tela (v3)**: cada painel mostra a tecla que o aciona, legenda de controles no rodapé, sobreposição com teclado e mouse desenhados (H), marcadores de objetivo com distância, mapa tático (M), lista "Primeiros passos" na primeira partida, menus e tela de implantação refeitos.
- **4 classes no estilo Battlefield**, cada uma com armas e gadget próprios:

  | Classe | Armas | Gadget (F) |
  |---|---|---|
  | Assalto | K-7 Carabina, Arco B-9 Bullpup | Seringa de adrenalina (cura + sprint), +1 granada, regeneração rápida |
  | Engenheiro | Vespa SMG, Faísca PDW, Martelo 12 | Lança-foguetes RPG-Q (derruba prédios), resistência a explosões |
  | Suporte | Trovão M-100 (cinto de 100), Bigorna .30 (tambor de 60) | Caixa de suprimentos (munição + cura em área), munição extra |
  | Reconhecimento | Lança DMR (4x), Órion .338 (8x, ferrolho), Vigia 7.62 (5x) | Sensor de movimento (marca inimigos em 30 m) |

  Secundárias para qualquer classe: P9, Juiz .44 (revólver), Rajada MP (automática).
- **Balística por projétil**, não *hitscan*: cada bala integra `x(t) = x₀ + v₀t + ½gt²` com arrasto quadrático `dv/dt = −k·v|v|`, logo `v(x) = v₀e^(−kx)` e o tempo de voo é `t(x) = (e^(kx) − 1)/(k·v₀)`. Dano ∝ (v/v₀)², então o alcance pesa de verdade. Ex.: a Vespa (420 m/s) leva ~0,25 s e cai ~29 cm em 100 m; a Órion (900 m/s) leva ~0,11 s e cai ~6 cm. A ficha de cada arma no menu mostra velocidade, queda a 100 m, tempo de voo, TTK e poder de destruição.
- **Gunplay pesado**: recuo vertical com viés horizontal por arma, recuperação parcial, *bloom*, multiplicador de cabeça, ADS com FOV por mira (iron, red dot, holo, lunetas 4x/5x/8x com balanço de respiração), estalo de bala passando perto (*whiz*) e supressão.
- **Animações de recarga por tipo**: troca de pente (mais lenta com a arma vazia), tampa e cinto da LMG, cartucho a cartucho na escopeta, tambor do revólver, ferrolho manual nos snipers, foguete no RPG.
- **Progressão**: medalhas (multi-kill, tiro longo > 50 m, headshot, kill pelo eco, kill saindo do túnel, sequências), XP por partida e 10 patentes de RECRUTA a GENERAL QUÂNTICO; loadout salvo entre partidas; 3 níveis de dificuldade.
- **Mapa detalhado**: 15 veículos estacionados com faróis que iluminam o chão, letreiros neon (KAPPA, LAB, HANGAR, OMEGA), torre de sniper com passarela até o 3º andar do laboratório, servidores piscando, radar no telhado, caixa d'água, pátio de geradores, poças, calçadas, cercas e **25 barris explosivos** que explodem em cadeia.
- **Gráficos mais realistas sem custo**: halo de luz (*bloom* falso) em volta de cada lâmpada e reflexo alongado no asfalto molhado, tudo em 2 *draw calls*, reconstruído só quando uma lâmpada é destruída.
- **Áudio com gravações reais (v3)**: 290 sons em 118 grupos, todos de gravações livres. Tiro próprio para cada uma das 14 armas (com variações para não soar metralhadora de videogame), recarga cronometrada com a animação (pente, ferrolho, cinto, tambor, cartucho a cartucho), passos por superfície (concreto, metal, madeira, terra, grama, água, vidro), impactos por material, ricochetes, balas passando, explosões diferentes para granada, foguete, barril e reator, trovões, chuva (muda quando você entra em um prédio), vento, batalha ao longe e **trilha adaptativa** (menu, tensão quando um ponto é disputado ou os tickets acabam, vinhetas de vitória e derrota). Motor próprio em WebAudio: barramentos com compressor e limitador, 40 vozes com prioridade, **atraso de propagação c = 343 m/s**, absorção do ar, **oclusão por *ray-march* nos voxels** (tiro atrás da parede soa abafado), tiro distante troca para gravação de longe, reverb de sala ou de rua conforme o teto acima de você, zumbido no ouvido após explosão próxima e batimento cardíaco com vida baixa. Tudo embutido no `game.js` (roda offline, sem `fetch`).
- **Bots**: A* em grade 2,5D, busca de cobertura quando feridos/suprimidos/recarregando, percepção com linha de visada, tempo de reação, erro de mira que converge, rajadas, *strafe*, agachar, granadas balísticas contra quem se esconde, objetivo de conquista, *rubber-band* de dificuldade.
- **Evento de mapa**: quando os tickets caem, o reator central entra em sobrecarga (sirene + contagem de 20 s) e explode em cadeia, remodelando o centro do mapa e apagando sua luz.
- **Luz dinâmica destrutível**: atire nas lâmpadas para escurecer uma sala (a luz é recalculada localmente por BFS).
- **Conquista**: 3 bandeiras (Laboratório, Reator, Hangar), 300 tickets, sangria de tickets por domínio, tela de implantação com escolha de arma e ponto de spawn, minimapa, killfeed, placar.
- **Leve**: cerca de 290 *draw calls* com 15 soldados na tela (eram 410–540 na v2, porque cada soldado e cada arma agora é uma malha só), um único atlas procedural de 256×256, resolução adaptativa automática (mantém ~60 FPS em GPU integrada), opção de qualidade baixa.

## Desenvolvimento

```bash
npm ci
npm run build          # dist/index.html + dist/game.js
npm test               # playtest automatizado (piloto IA joga uma partida, coleta métricas e screenshots)
node test/balance.cjs  # bots vs bots, simetria de times
npm run package        # out/Colapso-windows.zip (Electron win32-x64)
```

Um commit em `main` com `[release]` na mensagem (ou execução manual do workflow) dispara o GitHub Actions que empacota e publica a release.

Estrutura: `src/world.js` (voxels, luz, destruição, raycast DDA), `src/mapgen.js` (mapa procedural), `src/player.js`, `src/weapons.js` (tabela de armas), `src/kit.js` (kit pixel-art), `src/guns.js` (modelos), `src/viewmodel.js` (primeira pessoa), `src/soldier.js` (soldados), `src/ai.js`, `src/abilities.js`, `src/audio.js` + `src/sounds/` (gerado por `tools/audio/build-sounds.mjs`), `src/fx.js`, `src/hud.js` + `src/ui-icons.js`, `src/main.js`.

Gráficos e mapa são procedurais (código próprio); única dependência de runtime: [three.js](https://threejs.org) (MIT). O áudio usa gravações de acervos livres (Soldat base assets e Oculus Audio Pack, CC BY 4.0, modificadas; Kenney, Sonic Pi e trilha de Rafael Krux/FreePD, CC0): a lista por arquivo, com autores, licenças e modificações, está em [CREDITS.md](CREDITS.md) e na tela COMO JOGAR do jogo.
