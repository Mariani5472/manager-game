# Game Engine — auditoria e contratos (Etapa 4.1)

**Branch auditada:** `organize-current-functions`  
**Base da auditoria:** código e schema existentes no branch no momento desta alteração.  
**Objetivo:** registrar o estado real da implementação e estabelecer contratos para a integração da Game Engine com o site, sem implementar ainda as telas ou os endpoints de partida.

## 1. Resumo executivo

A Game Engine já existe. O projeto contém um simulador estatístico de partidas com timeline de 90 minutos, geração de eventos, pressão por minuto, contexto ambiental, escalação, alterações táticas, persistência incremental e atualização de condições dos jogadores.

O gargalo da próxima etapa não é criar um simulador do zero. É transformar os serviços existentes em uma experiência de partida acessível e controlável pelo frontend.

**Já existe:** domínio de simulação, persistência SQLite, calendário/fixtures, montagem automática de times, preview/salvamento de escalação, alterações táticas agendadas, momentum e atualização de classificação.

**Ainda não existe como fluxo HTTP de campanha:** endpoints para obter detalhes de uma partida, preparar escalação, iniciar, avançar por intervalos, pausar/reproduzir, consultar eventos/estatísticas e enviar comandos táticos.

## 2. Auditoria por domínio

### 2.1 Calendário e fixtures

Arquivos principais:
- `apps/api/game/fixtureService.ts`
- `apps/api/game/calendar/calendarService.ts`
- `apps/api/game/calendar/scheduleGenerator.ts`
- `apps/api/game/matchdayService.ts`

O calendário é orientado por competição, temporada, fase, rodada e fixture. A tabela `fixture` persiste clubes mandante/visitante, estádio, agendamento, status, placar, pênaltis, minuto atual e seed aleatória.

Status persistidos no schema:
- `SCHEDULED`
- `IN_PROGRESS`
- `COMPLETED`
- `POSTPONED`
- `CANCELLED`

Serviços existentes:
- `listFixtures`: consulta calendário e resultado resumido.
- `advanceRound`, `advanceStageRound`, `advanceRoundById`: simulam fixtures pendentes de uma rodada.
- `advanceNextFixture`: simula o próximo fixture elegível.
- `advanceFixtureRound`: simula todos os jogos pendentes da rodada que contém o próximo jogo do clube gerenciado, ou da rodada informada.

A geração round-robin já existe e considera número de turnos e mando.

**Limitação de integração:** `CampaignService` expõe apenas o calendário resumido; não há endpoint de detalhe do fixture nem ação de partida na API de campanha.

### 2.2 Motor de simulação

Arquivos principais:
- `apps/api/game/matchEngine.ts`
- `apps/api/game/matchEngine/matchSimulationService.ts`
- `apps/api/game/matchEngine/timelineSimulator.ts`
- `apps/api/game/matchEngine/probabilityModel.ts`
- `apps/api/game/matchEngine/strengthCalculator.ts`
- `apps/api/game/matchEngine/teamService.ts`
- `apps/api/game/matchEngine/types.ts`

O motor atual:
- usa seed derivada do fixture para resultados reproduzíveis;
- calcula força do time a partir de atributos, posições, condição, moral e sharpness;
- simula 90 iterações de minuto;
- calcula pressão de cada lado e chance de criação de finalização;
- resolve qualidade da chance, precisão, conversão e atuação do goleiro;
- gera eventos como gols, defesas, finalizações, faltas, cartões, lesões, substituições e alterações táticas;
- aceita alterações táticas agendadas por minuto;
- devolve `MatchSummary` com placar, chutes, chutes no alvo e xG.

O modelo de probabilidade já considera mentalidade, pressão, atributos agregados, mando, clima, condição do gramado, descanso e viagem.

**Limitação importante:** `simulateMatch` calcula a timeline inteira em memória antes de persistir os minutos. Embora grave checkpoints por minuto e possa recomputar deterministicamente uma timeline para continuar de um checkpoint, a chamada atual é síncrona e não oferece uma sessão de playback controlável pelo site.

### 2.3 Persistência da partida

Tabelas já existentes no schema:
- `fixture`: status, placar, minuto atual e seed.
- `match_lineup`: titulares e banco por fixture.
- `match_player_state`: condição e estatísticas individuais da partida.
- `match_event`: eventos cronológicos.
- `match_momentum`: pressão e placar por minuto.
- `match_environment`: clima e condição do gramado.
- `match_simulation_state`: checkpoint versionado.
- `match_tactical_change`: alterações táticas agendadas.

O simulador:
1. valida o estado do fixture;
2. prepara/recarrega condição do elenco quando necessário;
3. resolve e persiste o contexto ambiental;
4. carrega times, escalações e alterações táticas;
5. registra kickoff e checkpoint inicial;
6. persiste eventos, momentum, placar e checkpoint a cada minuto;
7. consolida estado dos jogadores e marca o fixture como `COMPLETED`.

O checkpoint atual armazena seed, configuração e métricas acumuladas em `state_json`. A retomada é baseada em recomputar a timeline determinística e ignorar minutos já persistidos; não é uma continuação baseada em estado interno completo de RNG/posse.

**Ponto de atenção:** não adicionar uma segunda fonte de verdade para placar/minuto/eventos. As tabelas existentes devem continuar sendo a fonte persistida da partida.

### 2.4 Jogadores, elenco e escalação

Arquivos principais:
- `apps/api/game/squadService.ts`
- `apps/api/game/lineupService.ts`
- `apps/api/game/matchEngine/playerLoader.ts`
- `apps/api/game/matchEngine/lineupService.ts`

Já existem:
- consulta de elenco com posições, camisa, status, energia, moral e sharpness;
- preview de escalação com base na formação e compatibilidade de posição;
- salvamento de 11 titulares e até 7 reservas por fixture;
- validação de vínculo com o clube, disponibilidade, suspensão e goleiro;
- carregamento de atributos e condição para a engine;
- seleção automática de escalação quando não existe uma escalação válida salva.

A engine lê escalação de `match_lineup`, tática de `team_tactic` e condições de `player_condition`.

**Limitação de integração:** os serviços de preview/salvamento ainda não estão expostos pelas rotas de campanha. A escalação automática do motor pode permitir simular sem preparação explícita, mas a experiência de manager precisa chamar a preparação antes do kickoff.

### 2.5 Competições e atualização pós-jogo

Arquivos principais:
- `apps/api/game/competition/competitionService.ts`
- `apps/api/game/competition/standingsService.ts`
- `apps/api/game/competition/knockoutService.ts`
- `apps/api/game/competition/seasonService.ts`
- `apps/api/game/matchdayService.ts`

A classificação é reconstruível a partir de fixtures concluídos. O fluxo de rodada também aciona progressão de mata-mata e conclusão de temporada.

**Limitação de escopo do simulador atual:** o schema possui configuração de prorrogação e pênaltis, além de campos de placar de pênaltis, mas a timeline atual executa 90 minutos e não resolve prorrogação ou disputa de pênaltis. Isso deve ser tratado como requisito explícito de uma etapa posterior, não presumido como já implementado.

### 2.6 API e frontend

Rotas atuais de campanha:
- `GET /:saveId/campaign/overview`
- `GET /:saveId/campaign/calendar`
- `GET /:saveId/campaign/squad`
- `GET /:saveId/campaign/team`

O frontend consome os contratos em `apps/shared/src/contracts/campaign.contracts.ts`. Não foi encontrada rota HTTP de partida nem uma tela de centro de partida.

Portanto, a integração deve reutilizar o padrão de módulos da API e os contratos compartilhados, em vez de colocar lógica de simulação no frontend.

## 3. Estados e transições

### 3.1 Estado persistido do fixture

O estado persistido é o status de `fixture`. Transições permitidas:

| Estado atual | Próximo estado permitido |
|---|---|
| `SCHEDULED` | `IN_PROGRESS`, `POSTPONED`, `CANCELLED` |
| `POSTPONED` | `SCHEDULED`, `CANCELLED` |
| `IN_PROGRESS` | `COMPLETED` |
| `COMPLETED` | Nenhum (terminal) |
| `CANCELLED` | Nenhum (terminal) |

Uma partida não pode ser iniciada se estiver concluída, cancelada ou adiada. Um fixture adiado precisa voltar a `SCHEDULED` antes do kickoff.

### 3.2 Estado de playback

Pausa não deve virar um novo status persistido de fixture. `PAUSED` é estado de playback/sessão. O fixture continua `IN_PROGRESS` enquanto o usuário pausa a apresentação ou interrompe avanços.

| Playback atual | Próximo playback |
|---|---|
| `IDLE` | `PLAYING` |
| `PLAYING` | `PAUSED`, `FINISHED` |
| `PAUSED` | `PLAYING` |
| `FINISHED` | Nenhum |

Isso separa o estado esportivo persistido do estado de apresentação. Fechar a tela não deve cancelar nem concluir a partida.

## 4. Contratos compartilhados definidos

Novo arquivo: `apps/shared/src/contracts/match.contracts.ts`.

O contrato estabelece:
- enumeração e transições válidas de fixture;
- estado de playback independente;
- tipos de eventos compatíveis com a tabela `match_event`;
- placar e placar de pênaltis;
- pontos de momentum;
- estatísticas que o motor já calcula (gols, chutes, chutes no alvo e xG);
- composição de times e jogadores da partida;
- resposta agregada do Centro de Partida;
- request de preparação da escalação;
- comandos tipados para alterações táticas;
- request de avanço e metadados de checkpoint.

As estatísticas foram deliberadamente limitadas ao que a engine atualmente calcula. Posse de bola, passes, escanteios e mapas de calor não fazem parte do contrato inicial porque ainda não são produzidos de forma confiável pelo simulador.

## 5. Contratos HTTP propostos para a etapa de integração

Os caminhos abaixo são proposta para a próxima etapa; não são endpoints já implementados.

| Método | Endpoint | Responsabilidade |
|---|---|---|
| `GET` | `/:saveId/matches/:fixtureId` | Centro de partida: times, placar, eventos, momentum e estatísticas |
| `GET` | `/:saveId/matches/:fixtureId/lineup/:clubId` | Preview da escalação |
| `PUT` | `/:saveId/matches/:fixtureId/lineup` | Salvar titulares e banco |
| `POST` | `/:saveId/matches/:fixtureId/start` | Validar preparação e iniciar |
| `POST` | `/:saveId/matches/:fixtureId/advance` | Avançar até determinado minuto |
| `POST` | `/:saveId/matches/:fixtureId/tactical-changes` | Agendar decisão tática |
| `GET` | `/:saveId/matches/:fixtureId/events` | Consultar eventos incrementais |

Pausa/playback deve ser controlada pelo cliente enquanto não houver simulação assíncrona no servidor. O endpoint de avanço será responsável por persistir progresso e devolver o novo estado. Requisições repetidas precisam ser idempotentes ou rejeitadas com conflito de estado; nunca podem duplicar eventos.

## 6. Decisões técnicas para a próxima etapa

1. Reutilizar `simulateMatch`, `simulateMatchTimeline`, `loadTeam` e os serviços existentes.
2. Não criar tabelas paralelas para eventos, momentum, escalações ou placar.
3. Manter o SQLite do save como fonte de verdade.
4. Expor operações de partida por um módulo HTTP próprio, sem acoplar a engine ao Express.
5. Separar status do fixture de playback da interface.
6. Antes de implementar avanço por intervalos, decidir se a engine será refatorada para gerar/persistir lotes de minutos ou se a primeira integração aceitará a chamada síncrona completa. Não simular um streaming que o backend ainda não suporta.
7. Adicionar idempotência/controle de concorrência nos comandos de start/advance.
8. Medir o custo da simulação em lote de temporadas; não sacrificar o limite de duas horas por causa da experiência ao vivo.

## 7. Lacunas e riscos registrados

- Não há endpoints de partida nem tela de partida.
- A simulação atual é síncrona e calcula a timeline inteira antes de gravar os checkpoints.
- O checkpoint é versionado, mas a retomada recomputa a timeline determinística.
- A engine não calcula posse, passes, escanteios ou métricas avançadas.
- `match_player_state.rating` recebe atualmente valores fixos (6.3 para titulares e 6.0 para reservas); gols/assistências e outras métricas individuais não são consolidadas pelo fluxo atual.
- O motor atual termina em 90 minutos; prorrogação e pênaltis ainda não estão implementados apesar de haver campos/configuração no schema.
- O evento `HALF_TIME` existe no schema, mas não é emitido pela timeline atual.
- A tabela `match_event` aceita tipos além dos efetivamente gerados pelo kernel; contratos refletem o conjunto persistível, não afirmam que todos já são produzidos.

## 8. Critério de conclusão da Etapa 4.1

- [x] Auditoria de calendário, fixtures, jogadores, competições e serviços de simulação.
- [x] Mapeamento das tabelas de persistência e fluxo atual da engine.
- [x] Definição dos contratos compartilhados.
- [x] Definição das transições de estado persistido e playback.
- [ ] Endpoints e telas de partida — fora do escopo desta subetapa.
- [ ] Refatoração do motor para avanço interativo — fora do escopo desta subetapa.
