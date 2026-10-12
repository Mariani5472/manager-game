# Data Packages — formato 1

Um pacote é um arquivo JSON UTF-8 com schemaVersion: 1. Os códigos são identificadores estáveis definidos pelo autor; use-os em referências internas em vez de IDs SQLite, pois IDs locais variam entre saves.

## Estrutura principal

- id: identificador único do pacote, por exemplo community.example-regional.
- version: versão semântica MAJOR.MINOR.PATCH.
- minGameVersion: versão mínima do motor.
- dependencies: lista de objetos com id e version. A dependência precisa estar instalada no save antes do pacote dependente; a versão informada é exata.
- nations, cities, clubs, stadiums, players: entidades referenciadas pelos códigos.
- competitions: competições com tier opcional, temporadas, etapas, formato, grupos, participantes, regras de classificação, calendário e movimentações.

## Formato de competição

Cada etapa define kind (LEAGUE, GROUPS, KNOCKOUT, SINGLE_MATCH ou FINAL), participants e um format opcional. O formato aceita groupCount, legs, homeAway, extraTime, penalties, awayGoalsRule e a pontuação de vitória/empate/derrota. Critérios de classificação válidos: POINTS, GOAL_DIFFERENCE, GOALS_FOR, HEAD_TO_HEAD, WINS, FAIR_PLAY e DRAW.

Para ligas e grupos, o calendário round-robin é gerado se calendar não for fornecido. Para uma etapa eliminatória, forneça calendar com as partidas por rodada para representar sorteios específicos; sem calendário, o motor monta uma rodada inicial por seed, não uma árvore de mata-mata completa.

Uma regra de promoção/rebaixamento contém positionFrom, positionTo, movementType e exatamente um destino: targetCompetitionCode ou targetTier. Para que as divisões troquem participantes, inclua as regras recíprocas de promoção e rebaixamento e tenha as temporadas do próximo ano criadas antes de executar apply-movements.

## Fluxo recomendado

1. Copie o exemplo e atribua novos códigos estáveis.
2. Declare todas as entidades e referências necessárias; para entidades de outro pacote, declare uma dependência.
3. Valide com data-package-validate em um save de teste.
4. Instale com data-package-install no save desejado.
5. Simule uma temporada de teste e verifique calendário, classificação e integridade SQLite.
6. Só aumente version quando publicar alterações; uma versão igual é tratada como já instalada.

O pacote é aplicado ao save escolhido e não altera o banco matriz. Faça backup do save antes de testar uma atualização de pacote.
