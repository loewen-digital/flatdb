# FlatDB

Flat-file document database for TypeScript/JavaScript.

## Reference

- Full API design: see `flatdb-api-design.md`
- Package: `@loewen-digital/flatdb`
- Tooling: npm (no yarn/pnpm)
- Format: JSON (fixed, not configurable)
- Schema: Zod
- No React

## Architecture

- Core is framework-agnostic
- StorageAdapter pattern (FsAdapter, IndexedDBAdapter, MemoryAdapter)
- 1 JSON file per document
- _index.json per collection for fast queries
- Reactivity via internal EventEmitter in Core
