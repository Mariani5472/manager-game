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

## API de escalação

`previewLineup(db, clubId, fixtureId)` sugere 11 titulares e até sete reservas. `saveLineup(db, fixtureId, clubId, starterIds, benchIds)` grava a escolha antes do kickoff, após validações.

## Limites conhecidos

Substituições dinâmicas durante o jogo e a influência completa de clima e viagem ainda não estão conectadas ao kernel nesta fase. A prioridade é fazer as decisões pré-jogo terem efeito demonstrável mantendo o processamento rápido e orientado a eventos.
