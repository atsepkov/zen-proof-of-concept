
# Zen Engine Bun Server POC

This repository contains a minimal [Bun](https://bun.sh/) server that stores and
serves JSON Decision Model (JDM) rules using [GoRules Zen Engine](https://gorules.com/).
The `/editor` endpoint hosts the React-based
[`@gorules/jdm-editor`](https://github.com/gorules/jdm-editor) component to
craft JDM documents in the browser and publish them to a local SQLite database.
The `/analyze` endpoint showcases executing the rules against generated test
data using Zen Engine.

## Endpoints

- `GET /editor` – React JDM editor prefilled with a sample shipping rule that
  demonstrates a decision table for weight-based base rates, a switch node for
  international logic and a JavaScript function for error‑tolerant cost
  calculation. It can load existing rules and publish updates to a local SQLite
  database.
- `GET /analyze` – interactive page to generate sample parts (including
  `origin_country`) and run them through a ruleset via Zen Engine. The analyzer
  inspects the rule's input fields to prefill compatible part properties.
- `POST /rulesets` – backend endpoint used by the editor to save rules. Versions
  are automatically incremented.
- `GET /rules` – list all available rule IDs.
- `GET /rules/<id>` – list versions for a rule with creation dates and status.
- `GET /rules/<id>@<ver>` – fetch a rule by key such as `shipping@latest` or
  `shipping@42`.

## Running

```bash
bun install
bun run build:editor   # build frontend assets
bun run index.ts
```

The server listens on <http://localhost:3000>. Opening `/editor` loads the
JDM editor while `/analyze` allows running generated data through the rules
engine.

