
# Zen Engine Bun Server POC

This repository contains a minimal [Bun](https://bun.sh/) server that stores and
serves JSON Decision Model (JDM) rules using [GoRules Zen Engine](https://gorules.com/).
The `/editor` endpoint hosts the React-based
[`@gorules/jdm-editor`](https://github.com/gorules/jdm-editor) component to
craft JDM documents in the browser and publish them to a local SQLite database.
The `/analyze` endpoint showcases executing the rules against generated test
data using Zen Engine.

## Architecture
![Architecture](zen-poc.png)

## Endpoints

- `GET /editor` – React JDM editor prefilled with a sample shipping rule using
  expression nodes to compute base rates, tariffs, and totals from each part’s
  weight, cost, and origin country. It can load existing rules and publish
  updates to a local SQLite database.
- `GET /analyze` – interactive page to define property ranges, generate sample
  parts (including `origin_country`), and run them through a ruleset via Zen
  Engine. The analyzer inspects the rule's input fields to prefill compatible
  part properties.
- `GET /benchmark` – interactive page to generate random data and run
  performance comparisons.
- `POST /rulesets` – backend endpoint used by the editor to save rules. Versions
  are automatically incremented.
- `GET /rules` – list all available rule IDs.
- `GET /rules/<id>` – list versions for a rule with creation dates and status.
- `GET /rules/<id>@<ver>` – fetch a rule by key such as `shipping@latest` or
  `shipping@42`.
- `POST /benchmark/arbitrary-js` – current benchmark that measures native
  JavaScript logic versus Zen Engine expression and decision table execution.

## Running

```bash
bun install
bun run build:ui   # build frontend assets
bun run index.ts
```

The server listens on <http://localhost:3000>. Opening `/editor` loads the
JDM editor while `/analyze` allows running generated data through the rules
engine.

## Benchmarking

Benchmark implementations live in the `benchmarks/` directory. Each strategy
exposes a `POST /benchmark/<name>` endpoint and can be invoked with the
benchmark page or directly via HTTP.

Current strategies:

- `arbitrary-js` – builds Zen decisions from arbitrary JavaScript expressions to
  compare native execution with Zen expression and decision table equivalents.
  The frontend page posts to `/benchmark/arbitrary-js`.

Additional strategies such as ported GoRules examples can be added under the
same directory and exposed through their own `/benchmark/<name>` endpoint.

