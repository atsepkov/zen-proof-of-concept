import type { ZenEngine } from '@gorules/zen-engine';
import { promises as fs } from 'fs';
import { join } from 'path';
import { buildJsHandler, buildDurableHandler } from '../jdmParser.js';

const root = join(import.meta.dir, '..', '..');

export async function runBenchmark(
  engine: ZenEngine,
  parts: any[],
  _iterations: number,
  _propCount: number,
  extra: any
) {
  const file = extra.file as string;
  const text = await fs.readFile(join(root, 'test-data', file), 'utf8');
  const jdm = JSON.parse(text);
  const decision = engine.createDecision(jdm);
  decision.validate();

  const jsHandler = buildJsHandler(jdm);
  const durableHandler = await buildDurableHandler(jdm);

  const clone = (obj: any) => JSON.parse(JSON.stringify(obj));

  const jsOutputs: any[] = [];
  let jsTime = 0;
  if (jsHandler) {
    let start = performance.now();
    for (const p of parts) {
      const out = await jsHandler(clone(p));
      jsOutputs.push(out);
    }
    let end = performance.now();
    jsTime = end - start;
  }

  const zenOutputs: any[] = [];
  const durableOutputs: any[] = [];
  let start = performance.now();
  for (const p of parts) {
    const res = await decision.evaluate(clone(p));
    zenOutputs.push((res as any)?.result ?? res);
  }
  let end = performance.now();
  const zenTime = end - start;

  let durableTime = 0;
  if (durableHandler) {
    let dStart = performance.now();
    for (const p of parts) {
      const out = await durableHandler(clone(p));
      durableOutputs.push(out);
    }
    let dEnd = performance.now();
    durableTime = dEnd - dStart;
  }

  let mismatch: any = null;
  if (jsHandler) {
    const stable = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(stable);
      if (obj && typeof obj === 'object') {
        const out: any = {};
        for (const key of Object.keys(obj).sort()) {
          out[key] = stable(obj[key]);
        }
        return out;
      }
      return obj;
    };
    for (let i = 0; i < parts.length; i++) {
      const j = JSON.stringify(stable(jsOutputs[i]));
      const z = JSON.stringify(stable(zenOutputs[i]));
      const d = durableHandler
        ? JSON.stringify(stable(durableOutputs[i]))
        : z;
      if (j !== z || j !== d) {
        mismatch = {
          index: i,
          js: jsOutputs[i],
          zen: zenOutputs[i],
          durable: durableHandler ? durableOutputs[i] : null
        };
        break;
      }
    }
  } else {
    mismatch = {
      index: 0,
      js: null,
      zen: zenOutputs[0],
      durable: durableHandler ? durableOutputs[0] : null
    };
  }

  return {
    js: jsTime,
    zen: zenTime,
    durable: durableTime,
    sample: {
      input: parts[0],
      js: jsHandler ? jsOutputs[0] : null,
      zen: zenOutputs[0],
      durable: durableHandler ? durableOutputs[0] : null
    },
    mismatch
  };
}
