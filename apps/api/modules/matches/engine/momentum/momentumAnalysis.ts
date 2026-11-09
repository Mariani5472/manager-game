import { simulateMatchTimeline } from "../timelineSimulator.js";
import type { Team } from "../../types/match-engine.types.js";

export interface MomentumCalibrationReport {
  simulations: number;
  minutesObserved: number;
  averageHomeMomentum: number;
  averageAwayMomentum: number;
  averageAbsoluteMomentumDifference: number;
  averageAbsoluteStructuralPressureDifference: number;
  structuralPressureStandardDeviation: number;
  momentumStandardDeviation: number;
  averageDominanceChangesPerMatch: number;
  averageLongestDominanceRunMinutes: number;
  shotMinuteCorrelation: number;
  deterministic: boolean;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function standardDeviation(values: number[], average: number): number {
  if (!values.length) return 0;
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  const covariance = mean(left.map((value, index) =>
    (value - leftMean) * (right[index]! - rightMean)
  ));
  const denominator =
    standardDeviation(left, leftMean) *
    standardDeviation(right, rightMean);
  return denominator > 0 ? covariance / denominator : 0;
}

export function runMomentumCalibration(
  home: Team,
  away: Team,
  simulations = 1000,
  seed = 481516,
): MomentumCalibrationReport {
  if (!Number.isSafeInteger(simulations) || simulations < 100) {
    throw new Error("Momentum calibration requires at least 100 simulations.");
  }

  const homeValues: number[] = [];
  const awayValues: number[] = [];
  const differences: number[] = [];
  const structuralDifferences: number[] = [];
  const shotSignals: number[] = [];
  const absoluteDifferences: number[] = [];
  let dominanceChanges = 0;
  let longestRunTotal = 0;
  let deterministic = true;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const simulationSeed = seed + simulation * 7919;
    const timeline = simulateMatchTimeline(home, away, simulationSeed);
    const repeated = simulation === 0
      ? simulateMatchTimeline(home, away, simulationSeed)
      : null;
    if (repeated && JSON.stringify(timeline) !== JSON.stringify(repeated)) {
      deterministic = false;
    }

    let previousSide = 0;
    let currentRun = 0;
    let longestRun = 0;

    for (const minute of timeline.minutes) {
      const difference = minute.homePressure - minute.awayPressure;
      const side = Math.abs(difference) < 0.5 ? 0 : difference > 0 ? 1 : -1;
      if (side !== 0 && previousSide !== 0 && side !== previousSide) {
        dominanceChanges += 1;
      }
      if (side === 0) {
        currentRun = 0;
      } else if (side === previousSide) {
        currentRun += 1;
      } else {
        currentRun = 1;
      }
      longestRun = Math.max(longestRun, currentRun);
      if (side !== 0) previousSide = side;

      homeValues.push(minute.homePressure);
      awayValues.push(minute.awayPressure);
      differences.push(difference);
      structuralDifferences.push(minute.homeBasePressure - minute.awayBasePressure);
      absoluteDifferences.push(Math.abs(difference));
      shotSignals.push(
        minute.events.some(event =>
          ["GOAL", "SAVE", "MISS", "CHANCE"].includes(event.eventType)
        ) ? 1 : 0,
      );
    }
    longestRunTotal += longestRun;
  }

  const averageDifference = mean(differences);
  const averageStructuralDifference = mean(structuralDifferences);
  return {
    simulations,
    minutesObserved: simulations * 90,
    averageHomeMomentum: mean(homeValues),
    averageAwayMomentum: mean(awayValues),
    averageAbsoluteMomentumDifference: mean(absoluteDifferences),
    averageAbsoluteStructuralPressureDifference: mean(structuralDifferences.map(Math.abs)),
    structuralPressureStandardDeviation: standardDeviation(structuralDifferences, averageStructuralDifference),
    momentumStandardDeviation: standardDeviation(differences, averageDifference),
    averageDominanceChangesPerMatch: dominanceChanges / simulations,
    averageLongestDominanceRunMinutes: longestRunTotal / simulations,
    shotMinuteCorrelation: correlation(absoluteDifferences, shotSignals),
    deterministic,
  };
}
