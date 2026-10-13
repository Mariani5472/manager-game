export interface HistoricalMatchRecord {
  date: string; competition: string; homeGoals: number; awayGoals: number;
  homeShots?: number; awayShots?: number; homeShotsOnTarget?: number; awayShotsOnTarget?: number;
  homeXg?: number; awayXg?: number;
}
export interface HistoricalMetricSummary {
  matches: number; firstDate: string; lastDate: string;
  homeWinRate: number; drawRate: number; awayWinRate: number;
  averageHomeGoals: number; averageAwayGoals: number; averageTotalGoals: number;
  goallessRate: number; sixPlusTotalGoalsRate: number;
  homeWinByThreePlusRate: number; awayWinByThreePlusRate: number;
  averageTotalShots?: number; averageTotalShotsOnTarget?: number; averageTotalXg?: number;
  coverage: { shots: number; shotsOnTarget: number; xg: number };
}
export interface HistoricalCalibrationReport {
  schemaVersion: 1;
  dataset: { version: string; sha256?: string; competitions: string[]; matches: number; firstDate: string; lastDate: string };
  splitDate: string; training: HistoricalMetricSummary; validation: HistoricalMetricSummary;
  warnings: string[]; interpretation: string;
}
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function assertFiniteCount(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error(`${label} must be a non-negative integer.`);
}
function optionalNonNegative(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`${label} must be a non-negative finite number when provided.`);
}
function validateRecord(record: HistoricalMatchRecord, index: number): void {
  if (!record || typeof record !== "object") throw new Error(`Record ${index} must be an object.`);
  if (typeof record.date !== "string" || !isoDate.test(record.date) || Number.isNaN(Date.parse(record.date + "T00:00:00Z"))) throw new Error(`Record ${index}: date must use YYYY-MM-DD.`);
  if (typeof record.competition !== "string" || !record.competition.trim()) throw new Error(`Record ${index}: competition is required.`);
  assertFiniteCount(record.homeGoals, `Record ${index} homeGoals`);
  assertFiniteCount(record.awayGoals, `Record ${index} awayGoals`);
  for (const key of ["homeShots","awayShots","homeShotsOnTarget","awayShotsOnTarget"] as const) if (record[key] !== undefined) assertFiniteCount(record[key], `Record ${index} ${key}`);
  optionalNonNegative(record.homeXg, `Record ${index} homeXg`);
  optionalNonNegative(record.awayXg, `Record ${index} awayXg`);
  if (record.homeShotsOnTarget !== undefined && record.homeShots !== undefined && record.homeShotsOnTarget > record.homeShots) throw new Error(`Record ${index}: homeShotsOnTarget cannot exceed homeShots.`);
  if (record.awayShotsOnTarget !== undefined && record.awayShots !== undefined && record.awayShotsOnTarget > record.awayShots) throw new Error(`Record ${index}: awayShotsOnTarget cannot exceed awayShots.`);
}
function average(values: number[]): number | undefined { return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : undefined; }
function summarize(records: HistoricalMatchRecord[]): HistoricalMetricSummary {
  if (!records.length) throw new Error("Both training and validation partitions must contain at least one match.");
  const n=records.length, home=records.filter(m=>m.homeGoals>m.awayGoals).length, draws=records.filter(m=>m.homeGoals===m.awayGoals).length;
  const goals=records.map(m=>m.homeGoals+m.awayGoals);
  const shots=records.filter(m=>m.homeShots!==undefined&&m.awayShots!==undefined).map(m=>m.homeShots!+m.awayShots!);
  const sot=records.filter(m=>m.homeShotsOnTarget!==undefined&&m.awayShotsOnTarget!==undefined).map(m=>m.homeShotsOnTarget!+m.awayShotsOnTarget!);
  const xg=records.filter(m=>m.homeXg!==undefined&&m.awayXg!==undefined).map(m=>m.homeXg!+m.awayXg!);
  const avgGoals=goals.reduce((s,v)=>s+v,0)/n;
  return {
    matches:n,firstDate:records[0]!.date,lastDate:records[n-1]!.date,
    homeWinRate:home/n,drawRate:draws/n,awayWinRate:(n-home-draws)/n,
    averageHomeGoals:records.reduce((s,m)=>s+m.homeGoals,0)/n,
    averageAwayGoals:records.reduce((s,m)=>s+m.awayGoals,0)/n,averageTotalGoals:avgGoals,
    goallessRate:goals.filter(v=>v===0).length/n,sixPlusTotalGoalsRate:goals.filter(v=>v>=6).length/n,
    homeWinByThreePlusRate:records.filter(m=>m.homeGoals-m.awayGoals>=3).length/n,
    awayWinByThreePlusRate:records.filter(m=>m.awayGoals-m.homeGoals>=3).length/n,
    ...(average(shots)===undefined?{}:{averageTotalShots:average(shots)}),
    ...(average(sot)===undefined?{}:{averageTotalShotsOnTarget:average(sot)}),
    ...(average(xg)===undefined?{}:{averageTotalXg:average(xg)}),
    coverage:{shots:shots.length,shotsOnTarget:sot.length,xg:xg.length},
  };
}
/** Creates empirical reference targets; it intentionally does not tune engine coefficients. */
export function buildHistoricalCalibrationReport(records: HistoricalMatchRecord[], options:{datasetVersion:string;splitDate:string;sha256?:string}):HistoricalCalibrationReport {
  if (!options.datasetVersion.trim()) throw new Error("datasetVersion is required to identify the historical dataset.");
  if (!isoDate.test(options.splitDate)||Number.isNaN(Date.parse(options.splitDate+"T00:00:00Z"))) throw new Error("splitDate must use YYYY-MM-DD.");
  if (records.length<2) throw new Error("At least two historical matches are required.");
  records.forEach(validateRecord);
  const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)||a.competition.localeCompare(b.competition));
  const training=sorted.filter(m=>m.date<options.splitDate),validation=sorted.filter(m=>m.date>=options.splitDate);
  if (!training.length||!validation.length) throw new Error("splitDate must leave at least one match in both training (< splitDate) and validation (>= splitDate).");
  const warnings:string[]=[];
  if(training.length<100||validation.length<100)warnings.push("One or both partitions contain fewer than 100 matches; rates may be noisy.");
  const missingShots=sorted.filter(m=>m.homeShots===undefined||m.awayShots===undefined).length;
  const missingSot=sorted.filter(m=>m.homeShotsOnTarget===undefined||m.awayShotsOnTarget===undefined).length;
  const missingXg=sorted.filter(m=>m.homeXg===undefined||m.awayXg===undefined).length;
  if(missingShots)warnings.push(`${missingShots}/${sorted.length} matches lack paired shot counts.`);
  if(missingSot)warnings.push(`${missingSot}/${sorted.length} matches lack paired shots-on-target counts.`);
  if(missingXg)warnings.push(`${missingXg}/${sorted.length} matches lack paired xG values; do not infer xG from goals.`);
  return {schemaVersion:1,dataset:{version:options.datasetVersion,...(options.sha256?{sha256:options.sha256}:{}),competitions:[...new Set(sorted.map(m=>m.competition))].sort(),matches:sorted.length,firstDate:sorted[0]!.date,lastDate:sorted[sorted.length-1]!.date},splitDate:options.splitDate,training:summarize(training),validation:summarize(validation),warnings,interpretation:"Historical targets only. No engine coefficients were fitted. Use training for parameter exploration and validation only for final out-of-sample evaluation; compare like-for-like competitions, seasons and metric definitions."};
}
export function parseHistoricalJsonl(content:string):HistoricalMatchRecord[]{
 const records:HistoricalMatchRecord[]=[];
 for(const [index,line] of content.split(/\r?\n/).entries()){
  if(!line.trim()||line.trimStart().startsWith("#"))continue;
  try{records.push(JSON.parse(line) as HistoricalMatchRecord);}catch{throw new Error(`Invalid JSON on historical dataset line ${index+1}.`);}
 }
 return records;
}
