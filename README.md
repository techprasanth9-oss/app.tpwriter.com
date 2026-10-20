# TP Writer

A browser-based word processor. Flow-based document editor built on EditorJS, with CLM-specific tooling stripped. (The directory name is a historical artifact — the product is **TP Writer**.)

## Layout

```
apps/
  web/        React + Vite + TanStack Router + Tailwind + EditorJS
  api/        Hono + @hono/node-server + Drizzle + SQLite
packages/
  editor/     Framework-agnostic EditorJS tool registry + DOCX import/export
  shared/     Zod DTOs shared FE <-> BE
```

## Dev

```
pnpm install
pnpm dev
```

- Web:  http://localhost:3000
- API:  http://localhost:3001/health
