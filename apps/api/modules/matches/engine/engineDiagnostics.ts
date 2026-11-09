import type {
  SqliteDatabase,
} from "../../../db/database.js";
import {
  HOME_SHOT_CHANCE_BONUS,
  MATCH_EVENT_PROBABILITIES,
} from "./constants.js";
import {
  meanConfidenceInterval,
  wilsonInterval,
} from "./confidenceIntervals.js";
import {
  runMonteCarlo,
} from "./monteCarloService.js";
import {
  loadTeam,
} from "./teamService.js";
import {
  simulateMatchTimeline,
} from "./timelineSimulator.js";
import type {
  MatchEngineDiagnostics,
  Team,
  XgBandDiagnostic,
} from "../types/match-engine.types.js";


export function runEngineDiagnostics(
  db: SqliteDatabase,
  simulations = 2000,
  seed = 88421
): MatchEngineDiagnostics {
   if(!Number.isSafeInteger(simulations)||simulations<100)throw new Error("Diagnostics simulations must be an integer >= 100.");
   const ids=(db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(r=>r.id);
   if(ids.length<2)throw new Error("Diagnostics require at least two clubs.");
   const teams=ids.map(id=>loadTeam(db,-1,id,false));
   const strength=(t:Team)=>t.attacking*.4+t.defending*.35+t.goalkeeping*.25;
   const ranked=teams.map(team=>({team,value:strength(team)})).sort((a,b)=>a.value-b.value||a.team.clubId-b.team.clubId);
   const weak=ranked[0]!,strong=ranked[ranked.length-1]!;
   const baseline=runMonteCarlo(strong.team,weak.team,simulations,seed);
   const bands=[
    {label:"0.00-0.05",min:0,max:.05,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
    {label:"0.05-0.10",min:.05,max:.10,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
    {label:"0.10-0.15",min:.10,max:.15,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
    {label:"0.15-0.20",min:.15,max:.20,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
    {label:"0.20+",min:.20,max:Infinity,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
   ];
   for(let i=0;i<simulations;i++){
    const timeline=simulateMatchTimeline(strong.team,weak.team,seed+i*7919);
    for(const e of timeline.events){
     if(!["GOAL","SAVE","MISS"].includes(e.eventType)) continue;
     const b=bands.find(item=>e.xg>=item.min&&e.xg<item.max)!;
     b.shots++;b.xg+=e.xg;b.xgSquared+=e.xg*e.xg;
     if(e.eventType==="GOAL"){b.goals++;b.onTarget++;}
     else if(e.eventType==="SAVE"){b.saves++;b.onTarget++;}
     else b.misses++;
    }
   }
   
   const xgBands: XgBandDiagnostic[]=bands.filter(b=>b.shots>0).map(b=>({band:b.label,shots:b.shots,averageXg:b.xg/b.shots,averageXgInterval:meanConfidenceInterval(b.xg,b.xgSquared,b.shots),onTargetRate:b.onTarget/b.shots,onTargetInterval:wilsonInterval(b.onTarget/b.shots,b.shots),goalRate:b.goals/b.shots,goalInterval:wilsonInterval(b.goals/b.shots,b.shots),saveRate:b.saves/b.shots,saveInterval:wilsonInterval(b.saves/b.shots,b.shots),missRate:b.misses/b.shots,missInterval:wilsonInterval(b.misses/b.shots,b.shots),goals:b.goals,saves:b.saves,misses:b.misses}));
   const ab=runMonteCarlo(strong.team,weak.team,simulations,seed+1700003);
   const ba=runMonteCarlo(weak.team,strong.team,simulations,seed+1700003);
   const persistedRows=db.prepare("SELECT f.id,f.home_club_id,f.away_club_id,f.home_score,f.away_score,f.current_minute, s.simulation_minute,s.state_json,(SELECT COUNT(*) FROM match_momentum m WHERE m.fixture_id=f.id) AS momentum_count,(SELECT COUNT(*) FROM match_event e WHERE e.fixture_id=f.id AND e.event_type='GOAL' AND e.club_id=f.home_club_id) AS event_home_goals,(SELECT COUNT(*) FROM match_event e WHERE e.fixture_id=f.id AND e.event_type='GOAL' AND e.club_id=f.away_club_id) AS event_away_goals FROM fixture f LEFT JOIN match_simulation_state s ON s.fixture_id=f.id WHERE f.status='COMPLETED' ORDER BY f.id DESC LIMIT 100").all() as Array<{id:number;home_score:number;away_score:number;current_minute:number;simulation_minute:number|null;state_json:string|null;momentum_count:number;event_home_goals:number;event_away_goals:number}>;
   const issues:string[]=[];
   const warnings:string[]=[];
   for(const r of persistedRows){
    if(r.current_minute!==90)issues.push(`Fixture ${r.id}: completed with current_minute=${r.current_minute}`);
    if(r.event_home_goals!==r.home_score||r.event_away_goals!==r.away_score)issues.push(`Fixture ${r.id}: score differs from GOAL events`);
    if(r.momentum_count!==90)issues.push(`Fixture ${r.id}: expected 90 momentum rows, found ${r.momentum_count}`);
    if(r.simulation_minute===null){
     warnings.push(`Fixture ${r.id}: no simulation checkpoint; this may be a legacy match completed before checkpoint persistence was introduced`);
    }else{
     let checkpointCompleted=false;
     try { checkpointCompleted=!!r.state_json&&JSON.parse(r.state_json).completed===true; } catch { checkpointCompleted=false; }
     if(r.simulation_minute!==90||!checkpointCompleted)issues.push(`Fixture ${r.id}: final checkpoint exists but is malformed or incomplete`);
    }
   }
   const outcomeRatesSum=baseline.homeWinRate+baseline.drawRate+baseline.awayWinRate;
   return {
    simulations,baseline,
    statisticalAcceptance:{
     method:"Wilson score interval",confidenceLevel:0.95,
     outcomes:{
      homeWin:wilsonInterval(baseline.homeWinRate,simulations),
      draw:wilsonInterval(baseline.drawRate,simulations),
      awayWin:wilsonInterval(baseline.awayWinRate,simulations),
     },
     outcomeRatesSum,outcomeRatesPartition:Math.abs(outcomeRatesSum-1)<=1e-9,
     interpretation:"These are Monte Carlo sampling-uncertainty intervals, not empirical football-calibration targets. Compare them with historical baselines before declaring the model calibrated.",
    },
    xgBands,
    eventProbabilities:MATCH_EVENT_PROBABILITIES,
    homeAdvantage:{clubA:strong.team.clubId,clubB:weak.team.clubId,clubAWinRateAtHome:ab.homeWinRate,clubAWinRateAway:ba.awayWinRate,homeAdvantageDelta:ab.homeWinRate-ba.awayWinRate,shotChanceBonus:HOME_SHOT_CHANCE_BONUS,note:"Explicit home advantage: +0.004 absolute shot-creation probability per minute for the home side. The win-rate delta is a seeded Monte Carlo estimate, not a guarantee."},
    strengthGap:{weakClubId:weak.team.clubId,strongClubId:strong.team.clubId,weakStrength:weak.value,strongStrength:strong.value,strengthDifference:strong.value-weak.value,hasMeaningfulGap:strong.value-weak.value>=8,note:strong.value-weak.value>=8?"Club ratings provide a useful strength contrast.":"Available clubs are too similar for a meaningful favorite-versus-underdog test; use a save with a larger ratings spread.",strongWinRate:baseline.homeWinRate,drawRate:baseline.drawRate,weakWinRate:baseline.awayWinRate,strongAverageGoals:baseline.averageHomeGoals,weakAverageGoals:baseline.averageAwayGoals},
    persistedMatches:{checked:persistedRows.length,issues,warnings}
   };
}