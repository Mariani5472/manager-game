export interface BalanceSample {homeGoals:number;awayGoals:number;homeShots:number;awayShots:number;}
export interface BalanceSummary {simulations:number;homeWinRate:number;drawRate:number;awayWinRate:number;averageHomeGoals:number;averageAwayGoals:number;averageTotalGoals:number;homeShotRate:number;awayShotRate:number;meanAbsoluteGoalDifference:number;}
export function summarizeSamples(samples:BalanceSample[]):BalanceSummary{
 if(!samples.length)throw new Error("At least one sample is required.");let hw=0,d=0,aw=0,hg=0,ag=0,hs=0,as=0,diff=0;
 for(const s of samples){if(s.homeGoals>s.awayGoals)hw++;else if(s.homeGoals===s.awayGoals)d++;else aw++;hg+=s.homeGoals;ag+=s.awayGoals;hs+=s.homeShots;as+=s.awayShots;diff+=Math.abs(s.homeGoals-s.awayGoals);}
 const n=samples.length;return{simulations:n,homeWinRate:hw/n,drawRate:d/n,awayWinRate:aw/n,averageHomeGoals:hg/n,averageAwayGoals:ag/n,averageTotalGoals:(hg+ag)/n,homeShotRate:hs/n,awayShotRate:as/n,meanAbsoluteGoalDifference:diff/n};
}
