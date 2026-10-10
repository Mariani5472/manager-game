# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Fase 2 — decisões estratégicas

- **Escalação:** 11 titulares por slots da formação e até sete reservas. A API valida clube, disponibilidade, duplicidade e goleiro. Se ainda não existe uma escalação salva, a engine sugere automaticamente uma usando posição, atributos e condição individual.
- **Tática:** mentalidade, pressão, ritmo, linha defensiva, largura, passe direto e contra-ataque afetam a probabilidade de criar finalizações e superar a defesa.
- **Condição individual:** energia, stamina, moral e sharpness entram na avaliação da equipe. O desgaste pesa mais no fim da partida e titulares perdem mais energia que reservas.
- **Eventos explicáveis:** finalizações, defesas e gols incluem jogador envolvido e descrição; o xG e o momentum minuto a minuto ficam persistidos no save.
- **Balanceamento estatístico:** `runMatchBalanceAnalysis(db, clubA, clubB, 5000)` executa seeds em memória e fornece taxas de vitória/empate/derrota, gols médios, finalizações e diferença média de gols. `summarizeSamples` agrega amostras para testes de regressão.

## Testes

```bash
npm install
npm test
```

O kernel é pseudoaleatório e reproduzível por seed para facilitar comparações entre escalações/táticas. O motor continua sendo uma simulação probabilística compacta, não uma garantia de equilíbrio calibrado; os relatórios Monte Carlo devem orientar ajustes graduais nos parâmetros.


## Comandos de escalação e equilíbrio

```bash
# Prévia automática para a partida 1, com o clube controlado
npm run dev -- lineup 1 --save-id <save-id>

# Persistir IDs na ordem dos slots da formação (11 titulares e até 7 reservas)
npm run dev -- lineup 1 --club 1 --starters 1,3,4,5,6,9,10,11,15,16,17 --bench 2,7,8,12,13,14,18 --save-id <save-id>

# Rodar 5.000 simulações sem alterar o estado do save
npm run dev -- balance --home 1 --away 2 --simulations 5000 --save-id <save-id>
```

Os IDs em `--starters` seguem a ordem dos slots da formação; o ID na posição do slot `GK` precisa ser goleiro. A análise Monte Carlo é somente leitura e usa seeds determinísticas.

## API de escalação

`previewLineup(db, clubId, fixtureId)` sugere 11 titulares e até sete reservas. `saveLineup(db, fixtureId, clubId, starterIds, benchIds)` grava a escolha antes do kickoff, após validações.

## Limites conhecidos

Substituições dinâmicas durante o jogo e a influência completa de clima e viagem ainda não estão conectadas ao kernel nesta fase. A prioridade é fazer as decisões pré-jogo terem efeito demonstrável mantendo o processamento rápido e orientado a eventos.


## Correções do motor de partidas

- A partida jogada e a análise Monte Carlo usam o mesmo kernel probabilístico.
- As metas iniciais de calibração são aproximadamente 24 finalizações totais, 8,2 no alvo e 2,62 de xG combinado por partida; os testes validam intervalos em 5.000 simulações para reduzir dependência de uma única amostra.
- O motor persiste checkpoints por minuto em `match_simulation_state`, o minuto/placar atual em `fixture` e o momentum derivado dos mesmos eventos de gol.
- Se o processo for interrompido durante uma partida, execute novamente `play <fixture-id> --save-id <save-id>` para retomar do último checkpoint. Partidas concluídas continuam protegidas contra execução duplicada.



### Match engine diagnostics

Run a read-only diagnostic report against a save to inspect shot-level xG, conversion outcomes, side-swapped results, strength differences, and persisted-match integrity:

```bash
npm run dev -- diagnostics --simulations 5000 --save-id <save-id>
```

The report groups simulated shots into xG bands and counts goals, saves, and misses in each band. It compares the strongest and weakest available clubs, then reverses their home/away roles to expose any side-assignment effect. This is a diagnostic comparison, not a home-advantage mechanic: it does not itself add a home bonus. Finally, it audits up to 100 completed fixtures for agreement between goals and score, 90 momentum rows, and a completed minute-90 checkpoint. Review `persistedMatches.issues` first when investigating an existing save.


### Interpreting match diagnostics

The xG report samples low-, medium-, and high-quality chance profiles, so higher xG bands should be populated in a sufficiently large run. Side-swapped simulations use random streams tied to club identity, making the comparison paired and reproducible; because the engine currently has no explicit home bonus, the expected home-advantage delta is zero. The report also flags when the available clubs do not have enough rating separation for a meaningful favorite-versus-underdog test. Missing checkpoints on completed matches are warnings (potentially legacy data); malformed or incomplete checkpoints that exist remain errors.


## Validação avançada do motor

O comando `diagnostics` usa a diferença de força entre o clube mais forte e o mais fraco; o teste de favorito/azarão só é considerado significativo quando a diferença é de pelo menos 8 pontos. A taxa de vitórias do clube mais fraco ajuda a quantificar surpresas.

O mando de campo tem um modificador explícito e isolado de **+0,004 na probabilidade de criar uma finalização por minuto** para o mandante. Isso é um ajuste pequeno na criação de chances, não um bônus direto de gols. O relatório apresenta o modificador e a diferença de vitórias estimada por simulação pareada; essa diferença é uma estimativa, não uma garantia.

A análise Monte Carlo também registra partidas 0–0, jogos em que um time marca pelo menos cinco gols, partidas com seis ou mais gols no total, vitórias por três ou mais gols e o maior placar observado.

Compare quatro cenários táticos sem alterar o save. Todos usam o mesmo confronto e a mesma seed, e os overrides são aplicados somente em memória:

```bash
npm run dev -- tactics-impact --home 1 --away 3 --simulations 5000 --seed 73421 --save-id <save-id>
```

O relatório compara as táticas atuais com o mandante muito ofensivo, o mandante defensivo e o visitante com pressão alta. Cada cenário mostra diferenças em taxa de vitória do mandante, gols, finalizações e xG contra a linha de base.
