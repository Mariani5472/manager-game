import {
  clamp,
} from "./mathUtils.js";
import type {
  BinomialConfidenceInterval,
  MeanConfidenceInterval,
} from "../types/match-engine.types.js";


export function meanConfidenceInterval(
  sum: number,
  sumSquares: number,
  observations: number,
  confidenceLevel = 0.95
): MeanConfidenceInterval {
  const estimate = observations
    ? sum / observations
    : 0;

  if (observations < 2) {
    return {
      estimate,
      lower: 0,
      upper: 0.38,
      observations,
      confidenceLevel,
    };
  }


  const variance = Math.max(
    0,
    (
      sumSquares -
      sum * sum / observations
    ) /
    (observations - 1)
  );

  const margin =
    1.959963984540054 *
    Math.sqrt(
      variance / observations
    );


  return {
    estimate,
    lower: Math.max(
      0,
      estimate - margin
    ),
    upper: Math.min(
      0.38,
      estimate + margin
    ),
    observations,
    confidenceLevel,
  };
}


export function wilsonInterval(
  rate: number,
  trials: number,
  confidenceLevel = 0.95
): BinomialConfidenceInterval {
  const successes = Math.round(
    clamp(rate, 0, 1) * trials
  );

  const z =
    confidenceLevel === 0.95
      ? 1.959963984540054
      : confidenceLevel === 0.99
        ? 2.5758293035489004
        : 1.959963984540054;

  const probability =
    successes / trials;

  const zSquared = z * z;

  const denominator =
    1 + zSquared / trials;

  const center =
    (
      probability +
      zSquared / (2 * trials)
    ) /
    denominator;

  const margin =
    (
      z *
      Math.sqrt(
        (
          probability *
          (1 - probability) +
          zSquared / (4 * trials)
        ) /
        trials
      )
    ) /
    denominator;


  return {
    estimate: probability,
    lower: Math.max(
      0,
      center - margin
    ),
    upper: Math.min(
      1,
      center + margin
    ),
    successes,
    trials,
    confidenceLevel,
  };
}