# rawapay

Modern payment infrastructure for Pakistan. Building developer-friendly payment APIs and SDKs starting with JazzCash integration, expanding to multi-provider payments ("Stripe for Pakistan").

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS with shadcn in `apps/web`
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the web application.

## Project Structure

```
rawapay/
├── apps/
│   ├── docs/        # Documentation site (Next.js / Fumadocs)
│   └── web/         # Demo application & checkout tester (Next.js)
├── packages/
│   ├── config/      # Shared TypeScript configuration (@rawapay/config)
│   └── rawapay/     # Core SDK package (upcoming)
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run check-types`: Check TypeScript types across all apps
- `bun run check`: Run Oxlint and Oxfmt
