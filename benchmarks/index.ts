import type { ZenEngine } from '@gorules/zen-engine';
import { runBenchmark as runArbitraryJs } from './arbitrary-js';
import { runBenchmark as runTestData } from './test-data';

export type BenchmarkRunner = (
  engine: ZenEngine,
  parts: any[],
  iterations: number,
  propCount: number,
  extra?: any
) => Promise<any>;

export const benchmarks: Record<string, BenchmarkRunner> = {
  'arbitrary-js': runArbitraryJs,
  'test-data': runTestData
  // Additional benchmark strategies can be added here
};
