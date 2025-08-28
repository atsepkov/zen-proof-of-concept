import type { ZenEngine } from '@gorules/zen-engine';
import { runBenchmark as runArbitraryJs } from './arbitrary-js';

export type BenchmarkRunner = (
  engine: ZenEngine,
  parts: any[],
  iterations: number,
  propCount: number
) => Promise<any>;

export const benchmarks: Record<string, BenchmarkRunner> = {
  'arbitrary-js': runArbitraryJs
  // Additional benchmark strategies can be added here
};
