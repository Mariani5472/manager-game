# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Fase 2 — decisões estratégicas

- **Escalação:** 11 titulares por slots da formação e até sete reservas. A API valida clube, disponibilidade, duplicidade e goleiro. Se ainda não existe uma escalação salva, a engine sugere automaticamente uma usando posição, atributos e condição individual.
- **Tática:** mentalidade, pressão, ritmo, linha defensiva, largura, passe direto e contra-ataque afetam a probabilidade de criar finalizações e superar a defesa.
- **Condição individual:** energia, stamina, moral e sharpness entram na avaliação da equipe. O desgaste pesa mais no fim da partida e titulares perdem mais energia que reservas.
- **Eventos explicáveis:** finalizações, defesas e gols incluem jogador envolvido e descrição; o xG e o momentum minuto a minuto ficam persistidos no save.
- **Balanceamento estatístico:** `runMatchBalanceAnalysis(db, clubA, clubB, 5000)` executa seeds em memória e fornece taxas de vitória/empate/derrota, gols médios, finalizações e diferença média de gols. `summarizeSamples` agrega amostras para testes de regressão.

## Testes e baseline de regressão

```bash
npm install
npm test
npm run build
```

`npm test` executa primeiro o build TypeScript e depois a suíte de testes Node (`dist/tests/*.test.js`). O workflow de CI também executa `npm test` e `npm run build` em mudanças submetidas ao GitHub.

### Baseline do núcleo — temporada completa

O teste de integração `season integration validates standings, persistence, replay safety and cup completion`, em `src/tests/game.test.ts`, é o baseline de regressão do fluxo de temporada. Ele protege os seguintes contratos:

- **Classificação:** recalcula de forma independente jogos, vitórias, empates, derrotas, gols pró/contra, saldo, pontos e fair play a partir de partidas/eventos concluídos, comparando o resultado com `getStandings`.
- **Encerramento:** completa as seis rodadas da liga (12 partidas; cada um dos quatro clubes joga seis vezes) e verifica os status de etapa/temporada; conclui semifinais e final da copa e verifica o vencedor.
- **Idempotência:** tentar processar novamente uma rodada concluída deve falhar explicitamente sem alterar placares nem duplicar eventos ou momentum.
- **Persistência:** fecha e reabre o save e confirma classificação e status finais.
- **Integridade SQLite:** exige `integrity_check = ok` e nenhuma linha em `foreign_key_check`.

Mudanças futuras no calendário, simulação, classificação, persistência ou encerramento devem manter esse teste verde. Se uma regra do jogo mudar intencionalmente, atualize o teste junto com a regra e documente o contrato novo; não remova a cobertura só para fazer o CI passar.

O kernel é pseudoaleatório e reproduzível por seed para facilitar comparações entre escalações/táticas. O motor continua sendo uma simulação probabilística compacta, não uma garantia de equilíbrio calibrado; os relatórios Monte Carlo devem orientar ajustes graduais nos parâmetros.



## Fase 6 — contexto completo da partida

O motor aplica o contexto de cada jogo por efeitos agregados no cálculo de pressão e de finalizações, sem simular física ou ações segundo a segundo:

- **Clima e gramado:** `match_environment` persiste clima, temperatura e condição do gramado por partida. Sem override manual, o clima é gerado deterministicamente a partir da seed e do perfil climático da cidade; a qualidade base vem do estádio. Chuva, chuva forte, vento, calor e gramado ruim alteram a criação e a qualidade das chances.
- **Descanso e viagem:** o descanso é calculado entre datas de jogos concluídos; a recuperação pré-jogo restaura energia em blocos de oito pontos por dia completo. A viagem usa `travel_route` quando existe uma rota cadastrada; quando falta uma rota entre cidades diferentes, o modelo usa uma estimativa conservadora de 250 km. Descanso curto e deslocamento reduzem pressão e criação de chances.
- **Disponibilidade consistente:** suspensões e lesões são filtradas pela data da partida tanto na seleção automática quanto na prévia e no salvamento da escalação. A suspensão é reduzida após cada partida do clube, não antes do jogo em que o atleta ainda deve cumprir pena.
- **Decisões durante a partida:** `match_tactical_change` permite programar substituições, alteração de mentalidade, formação e ajustes de instruções por minuto. Cada decisão vira um evento persistido e afeta os minutos seguintes. Substituições validam titular/reserva e elegibilidade; a fadiga final considera se o atleta foi substituído ou entrou no decorrer do jogo.
- **Reprodutibilidade:** clima e alterações são persistidos e o timeline é reconstruído pela seed e pelas decisões agendadas; o checkpoint continua sendo gravado por minuto/evento, sem executar uma simulação segundo a segundo.

Exemplos:

```bash
# Prévia e escalação salva antes de preparar uma substituição
npm run dev -- lineup 1 --save-id <save-id>
npm run dev -- lineup 1 --club <club-id> --starters <11-ids-separados-por-virgula> --bench <ate-7-ids-separados-por-virgula> --save-id <save-id>

# Substituir um titular aos 60 minutos
npm run dev -- match-change <fixture-id> --club <club-id> --minute 60 --type SUBSTITUTION --out <player-id> --in <player-id> --save-id <save-id>

# Mudar a mentalidade aos 70 minutos
npm run dev -- match-change <fixture-id> --club <club-id> --minute 70 --type MENTALITY --mentality ATTACKING --save-id <save-id>

# Ajustar a pressão aos 55 minutos (0–100)
npm run dev -- match-change <fixture-id> --club <club-id> --minute 55 --type INSTRUCTION --key pressing --value 72 --save-id <save-id>

# Reorganizar a formação aos 75 minutos (use o ID da tabela formation)
npm run dev -- match-change <fixture-id> --club <club-id> --minute 75 --type FORMATION --formation <formation-id> --save-id <save-id>
```

As alterações devem ser agendadas antes de o motor processar o respectivo minuto. Para substituições manuais, salve primeiro a escalação para definir explicitamente os titulares e o banco. Mudanças em minutos já processados são rejeitadas. `travel_route` é opcional e pode ser preenchida pelos data packages/mods.

## Fase 5 — calibração da engine e mundo de 16 clubes

O comando `npm run dev -- init-master` cria ou reconcilia o banco matriz. No banco de fábrica original, o comando amplia o mundo ficcional para **16 clubes**, preservando a independência dos saves existentes. A migração automática só é permitida no banco matriz com as partidas de fábrica ainda agendadas; se houver resultados ou estado parcial, ela falha de forma explícita em vez de apagar progresso.

- **Liga Nacional de Teste:** 16 clubes, ida e volta, 30 rodadas e 240 partidas.
- **Copa Nacional de Teste:** os mesmos 16 clubes em mata-mata, começando nas oitavas; 8 + 4 + 2 + 1 = 15 partidas no total.
- **Elencos:** os 12 clubes adicionados recebem 18 jogadores, atributos, posições, condição, estádio e tática para poderem ser selecionados e simulados.
- **Integridade:** o teste de integração valida 16 participantes, 240 partidas de liga, 15 jogos de copa, classificação final, encerramento das duas competições e verificações SQLite.

A suíte de estratégia já compara cenários com seeds fixas e inclui favorito/azarão, impacto tático e goleiro excepcional. Um teste de benchmark imprime no log da CI o tempo de 5.000 simulações Monte Carlo, a média por partida real estimada a partir de uma rodada de oito jogos e o tempo total para completar a liga e a copa. Os valores variam conforme o runner; use-os como baseline comparativa, não como promessa universal de desempenho.

Para inicializar/reconciliar o banco matriz:

```bash
npm run dev -- init-master
npm run dev -- clubs
```

Crie uma campanha nova depois da migração para herdar os 16 clubes. Saves existentes não são alterados automaticamente.

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

## Calendário e processamento de rodadas

`advance-round` recebe o **número da rodada dentro de uma etapa**, não o ID global de `competition_round`. A etapa padrão é a liga (ID 1); use `--stage` para outra etapa:

```bash
# Rodadas 1 a 6 da liga (etapa 1)
npm run dev -- advance-round 1 --stage 1 --save-id <save-id>

# Primeira rodada da copa (etapa 2), seguida automaticamente da final
npm run dev -- advance-round 1 --stage 2 --save-id <save-id>
npm run dev -- advance-round 2 --stage 2 --save-id <save-id>
```

Em etapas eliminatórias, quando todos os jogos de uma rodada terminam, os vencedores avançam automaticamente para a próxima rodada. Empates são decididos em disputa de pênaltis determinística e os placares ficam persistidos em `home_penalties`/`away_penalties`; o vencedor é resolvido a partir do placar final e, em caso de empate, dos pênaltis persistidos. Reexecutar uma rodada concluída informa que ela já foi processada e não simula jogos novamente. A competição só termina depois de uma final concluída.

Se o banco matriz já existia antes da correção do calendário, execute `npm run dev -- init-master`: o comando reconcilia **somente** o calendário da liga ficcional padrão quando todas as partidas ainda estão agendadas. Os saves existentes não são alterados; crie um save novo após a reparação para testar o calendário corrigido.

## Simular uma temporada inteira

Para processar todas as rodadas pendentes da campanha, incluindo liga e copa, execute:

```bash
npm run dev -- simulate-season --save-id <save-id>
```

O comando usa o mesmo processamento de `advance-round`: simula todas as partidas pendentes de uma rodada, imprime os resultados e, antes de seguir para a próxima rodada, imprime a classificação com o mesmo cálculo de `standings`. Na copa, as rodadas seguintes são criadas automaticamente conforme os vencedores avançam. Rodadas já concluídas são ignoradas, e o comando não reinicia nem apaga resultados existentes. Ao final, mostra o status das competições.

Também é possível abrir o save por caminho, usando `--save <caminho>` no lugar de `--save-id <save-id>`.

## API de escalação

`previewLineup(db, clubId, fixtureId)` sugere 11 titulares e até sete reservas. `saveLineup(db, fixtureId, clubId, starterIds, benchIds)` grava a escolha antes do kickoff, após validações.

## Regras de classificação da liga

As regras são aplicadas na ordem definida em `stage_standing_rule`. `HEAD_TO_HEAD` calcula uma mini-tabela apenas entre os clubes que continuam empatados após os critérios anteriores, usando pontos, saldo de gols e gols marcados nos confrontos diretos concluídos. Isso evita comparações par-a-par não transitivas em empates com três ou mais clubes.

`FAIR_PLAY` é uma pontuação disciplinar de penalidade reconstruída a partir dos eventos de partidas concluídas: 1 ponto por cartão amarelo e 3 por cartão vermelho. **Menos pontos disciplinares é melhor**, então o critério é ordenado de forma crescente. A classificação é reconstruível a partir dos jogos e eventos persistidos.

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

The report groups simulated shots into xG bands and counts goals, saves, and misses in each band. It compares the strongest and weakest available clubs, then reverses their home/away roles to expose any side-assignment effect. This is a diagnostic comparison, not itself a home-advantage mechanic. The match engine applies an explicit +0.004 absolute modifier to the home side's per-minute shot-creation probability; the diagnostic estimates the resulting home/away effect using paired simulations. Finally, it audits up to 100 completed fixtures for agreement between goals and score, 90 momentum rows, and a completed minute-90 checkpoint. Review `persistedMatches.issues` first when investigating an existing save.


### Interpreting match diagnostics

The xG report samples low-, medium-, and high-quality chance profiles, so higher xG bands should be populated in a sufficiently large run. Side-swapped simulations use random streams tied to club identity, making the comparison paired and reproducible. Because the engine includes a +0.004 absolute per-minute shot-creation modifier for the home side, the estimated home-advantage delta should be small and positive on average, but any finite Monte Carlo sample can vary. The report also flags when the available clubs do not have enough rating separation for a meaningful favorite-versus-underdog test. Missing checkpoints on completed matches are warnings (potentially legacy data); malformed or incomplete checkpoints that exist remain errors.


## Validação avançada do motor

O comando `diagnostics` usa a diferença de força entre o clube mais forte e o mais fraco; o teste de favorito/azarão só é considerado significativo quando a diferença é de pelo menos 8 pontos. A taxa de vitórias do clube mais fraco ajuda a quantificar surpresas.

O mando de campo tem um modificador explícito e isolado de **+0,004 na probabilidade de criar uma finalização por minuto** para o mandante. Isso é um ajuste pequeno na criação de chances, não um bônus direto de gols. O relatório apresenta o modificador e a diferença de vitórias estimada por simulação pareada; essa diferença é uma estimativa, não uma garantia.

A análise Monte Carlo também registra partidas 0–0, jogos em que um time marca pelo menos cinco gols, partidas com seis ou mais gols no total, vitórias por três ou mais gols e o maior placar observado.

Compare quatro cenários táticos sem alterar o save. Todos usam o mesmo confronto e a mesma seed, e os overrides são aplicados somente em memória. A suíte automatizada também cria um confronto sintético em uma campanha temporária: eleva os atributos de um clube, reduz os dos demais, exige diferença de força de pelo menos 8 pontos, confirma que o favorito vence mais vezes sem eliminar a chance de surpresa e verifica a reprodutibilidade do relatório tático. Esse cenário de teste não altera os dados de fábrica nem os coeficientes globais:

```bash
npm run dev -- tactics-impact --home 1 --away 3 --simulations 5000 --seed 73421 --save-id <save-id>
```

O relatório compara as táticas atuais com o mandante muito ofensivo, o mandante defensivo e o visitante com pressão alta. Cada cenário mostra diferenças em taxa de vitória do mandante, gols, finalizações e xG contra a linha de base.

### Diagnóstico de balance por temporadas

Execute simulações de temporadas completas com sementes diferentes para comparar pontos médios, saldo de gols, gols sofridos, favoritos e zebras:

```bash
npm run dev -- season-balance --save-id <save-id> --seasons 20 --seed 90210
```

O comando usa o elenco atual de cada clube e simula ida e volta entre todos os participantes. O resultado inclui médias por clube e por faixa de força (elite, competitivos, meio de tabela e parte inferior). A análise é diagnóstica e não altera partidas nem dados do save. Para uma campanha com 16 clubes, cada temporada virtual contém 240 partidas; o número de temporadas pode variar de 1 a 500.

Para aplicar os novos perfis a um save existente de 16 clubes, execute explicitamente (afeta atributos e reputações dos clubes desse save; partidas já concluídas permanecem intactas):

```bash
npm run dev -- recalibrate-squads --save-id <save-id>
```
