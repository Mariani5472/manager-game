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

