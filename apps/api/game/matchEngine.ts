export type { MatchSummary } from "../modules/matches/types/match-engine.types.js";
export { simulateMatch } from "../modules/matches/service/match-simulation.service.js";
export { scheduleMatchTacticalChange } from "../modules/matches/engine/tacticalChangeService.js";
export { runEngineDiagnostics } from "../modules/matches/engine/engineDiagnostics.js";
export { runMatchBalanceAnalysis } from "../modules/matches/engine/matchBalanceAnalysis.js";
export { runSyntheticSeasonScaleBenchmarks } from "../modules/matches/engine/syntheticBenchmark.js";
export { runTacticalSensitivityAnalysis } from "../modules/matches/engine/tacticalSensitivityAnalysis.js";
export { runSeasonBalanceAnalysis } from "../modules/matches/engine/seasonBalanceAnalysis.js";
export { runTacticalImpactAnalysis } from "../modules/matches/engine/tacticalImpactAnalysis.js";
