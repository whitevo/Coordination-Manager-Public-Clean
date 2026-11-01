# Code Conventions

## TypeScript
- Strict mode enabled across all packages
- No `any` type -- use `unknown` and narrow with type guards
- Use interfaces for object shapes, types for unions/primitives
- PascalCase for interfaces, types, components, and classes
- camelCase for variables, functions, and methods
- UPPER_SNAKE_CASE for constants
- kebab-case for file names

## React (apps/web)
- Function components with hooks only (no class components)
- Use contexts for shared state: useAuth(), useTheme(), useLearnerMode(), useToast()
- TailwindCSS for all styling (no CSS modules, styled-components, or inline styles)
- Use dark: prefix for dark mode, HSL CSS variable colors for theme support
- Import icons from lucide-react
- Use @/ alias for imports (resolves to src/)
- Lazy load pages with React.lazy() and Suspense
- Early returns for initial loading/error only when no usable content exists
- Background refresh loading/errors preserve usable content, local drafts, selection, and viewport
- Refresh/mutation changes use the shared reconciliation contracts; animation never controls persisted data

## Express (apps/api)
- Route files in src/routes/{feature}.ts
- Services in src/services/{feature}.ts
- Middleware in src/middleware/{type}.ts
- async/await for all async operations
- Custom error classes: ValidationError, UnauthorizedError, ApplicationError
- Error response format: { error: "CODE", message: "text", statusCode: N }

## Database
- Consolidated schema in packages/database/migrations/000_full_schema.sql
- Individual migrations numbered: NNN_{description}.sql
- Idempotent SQL: CREATE TABLE IF NOT EXISTS, DO $$ BEGIN ... END $$
- RLS enabled on all tables
- TIMESTAMPTZ for all timestamp columns
- created_by is TEXT (polymorphic: UUID, email, traveler_name, wallet_address)

## Text Content
- ASCII-safe characters only in source files
- No smart quotes (use straight quotes)
- No em dashes (use -- or regular dash)
- No encoded Unicode bullets (use - or *)
