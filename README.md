
# Zen Engine Bun Server POC

This repository contains a minimal [Bun](https://bun.sh/) server that stores and
serves JSON Decision Model (JDM) rules using [GoRules Zen Engine](https://gorules.com/).

## Endpoints

- `GET /editor` – simple form that publishes JDM rules to a local SQLite database.
- `POST /rulesets` – backend endpoint used by the editor to save rules. Versions
  are automatically incremented.
- `GET /rules/:key` – fetch a rule by key such as `shipping@latest` or
  `shipping@42`.

## Running

```bash
bun install
bun run index.ts
```

The server listens on <http://localhost:3000>. Opening `/editor` in the browser
provides a very basic UI to submit a JDM document.

