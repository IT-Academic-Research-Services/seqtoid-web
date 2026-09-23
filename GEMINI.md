# GEMINI.md — Developer and Agent Instructions for seqtoid-web

This file provides critical context, architectural details, commands, and development conventions for developers and AI agents working on the **seqtoid-web** codebase.

---

## 1. Project Overview

**seqtoid-web** (formerly known as `czid-web` or `idseq-web`) is the core web application and orchestrator for the **seqtoid** infectious-disease sequencing platform. It provides scientists with the ability to upload metagenomic sequencing data (FASTQ), associate metadata, dispatch and monitor bioinformatics pipelines, and explore visual reports detailing the abundance and confidence of detected pathogens.

### Core Architecture & Technologies
- **Backend:** Ruby 3.3.6, Rails 7.1.6, MySQL 8.0 (Aurora in AWS).
  - **GraphQL:** Native Rails-native GraphQL schema under `app/graphql/` (`graphql-ruby` 2.6). There is no separate federation server.
  - **Auth:** Auth0 integration via OmniAuth + JWT.
  - **Background Processing:** Resque (Redis) and Shoryuken (AWS SQS for Step Functions notification polling).
  - **Search:** OpenSearch / Elasticsearch.
  - **Workflows:** AWS Step Functions executing WDL-based workflows via the SWIPE engine.
- **Frontend:** React 18 + TypeScript, Relay (GraphQL client), Material-UI v5 & CZI Design System, Webpack, Node 20. Source is located in `app/assets/src/`.

---

## 2. Key Directories

- `app/` — Main Rails application codebase.
  - `controllers/` — Web and REST API controllers.
  - `models/` — ActiveRecord models (`Sample`, `Project`, `PipelineRun`, `WorkflowRun`, `TaxonCount`, `User`).
  - `services/` — Business logic and service layer.
  - `jobs/` — Background job definitions (Resque/Shoryuken).
  - `graphql/` — GraphQL schemas, queries, mutations, and types.
  - `assets/src/` — React/TypeScript frontend implementation.
- `config/` — Rails environment configurations and initializers.
- `db/` — Database migrations and seed scripts.
- `spec/` — Backend test suite using RSpec.
- `jest/` — Frontend unit/branch test suite using Jest.
- `e2e/` — End-to-end tests using Playwright.
- `docs/` — Detailed architecture, platform, and local development guides.

---

## 3. Building and Running

### Prerequisites
- Docker (BuildKit enabled)
- Ruby 3.3.6
- Node 20
- Local configuration in `web.env`

### Core Development Commands

#### Local Setup & Infrastructure
```bash
make local-init            # One-time initialization: build containers + setup
make local-db-setup        # Create database and populate with seeds
make local-db-reset        # Reset and re-seed the local database
make local-start-webapp    # Start Rails app + Webpack dev server (http://localhost:3001)
make local-stop            # Stop running containers
make local-console         # Open a bash shell inside the web container
make local-railsc          # Open the Rails console inside the web container
```

#### Frontend Development
```bash
npm start                  # Start Webpack dev server with hot reloading
npm run build-img          # Compile production frontend assets
npm run lint               # Run ESLint check
npm run type-check         # Run TypeScript compiler checks
npm test                   # Run Jest unit/branch tests
npm run relay              # Compile GraphQL/Relay queries
```

#### Backend Development
```bash
make rspec                 # Run backend tests using RSpec
bundle exec rubocop        # Check Ruby code style using RuboCop
bundle exec rubocop -A     # Run RuboCop with safe auto-corrections
```

---

## 4. Development Conventions

### General Workflow
- Always branch off and open Pull Requests targeting the **`integration`** branch (not `main`).
- Work should be kept to small, single-concern commits and PRs.
- Always validate tests and linter commands locally before pushing or merging.

### Backend (Ruby on Rails)
- Leverage **ActiveRecord models** inside `app/models/` for database interactions.
- MySQL 8.0 is strictly required (makes use of `ROW_NUMBER()` window functions which are unsupported in 5.7).
- Keep business logic isolated within **services** (`app/services/`) or background **jobs** (`app/jobs/`).
- Adhere to Rails conventions and ensure new code passes standard RuboCop style gates.

### Frontend (React & JavaScript/TypeScript)
- **Named Exports Only:** Always use named exports (e.g., `export const MyComponent = ...`) rather than default exports (`export default`). This ensures imports are fully searchable and trackable across the codebase.
- **Functional Components:** Prefer modern functional components using React Hooks rather than legacy class-based components.
- **CamelCase Naming:**
  - Identifiers, variables, objects, and methods should use `camelCase` (and align with corresponding backend `snake_case` fields).
  - Component classes and filenames should use `PascalCase` (e.g. `DiscoveryView.tsx`).
- **Event Naming:**
  - Event handlers should start with the `handle` prefix (e.g., `handleFilterClick`).
  - Event callback/prop hooks should start with `on` (e.g., `onFilterClick`).
- **Lodash/FP Usage:** Use `lodash/fp` exclusively. Traditional `lodash` is forbidden to maintain consistent immutable styles.
- **Built-in JS/TS Features:** Prefer native array/string methods (such as `Array.prototype.map`) and native Optional Chaining (`?.`) instead of `lodash` equivalents like `get`.
- **Fractal Directory Structure:** Follow the fractal component organization standard:
  ```
  MyComponent/
  ├── MyComponent.tsx
  ├── index.tsx              # Re-exports MyComponent
  ├── my_component.scss      # Component style file
  └── components/            # Folder for local sub-components
      └── SubComponent/
  ```
  - Use `hygen component new ComponentName` to bootstrap this directory structure.

---

## 5. Testing Guidelines

- **RSpec (Backend):** Write unit and request specs under `spec/`. Avoid obsolete minitest files.
- **Jest (Frontend):** Focus on maximizing branch/decision coverage (e.g., `jest/DiscoveryView-DiscoveryView-branches.test.tsx`). Test suite mocks external API wrappers and asserts component behavior and logic states cleanly.
- **Playwright (End-to-End):** Located in `e2e/`. Use to run functional end-to-end tests against real running services or staging.
