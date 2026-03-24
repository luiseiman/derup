# Contributing Guide

## Scope

derup is an academic ER/EER modeler for the Database course at UTN FRRe. Contributions should improve one or more of:

- ER/EER conceptual accuracy (diagram elements, constraints, mapping algorithm)
- Teacher and student usability
- Robustness of the chat-based and AI-assisted modeling workflow
- Test coverage

Out-of-scope: unrelated UI redesigns, new AI providers without tests, changes that break the relational schema derivation algorithm.

---

## Reporting bugs

Open a GitHub Issue and include:

- Expected behavior
- Actual behavior
- Steps to reproduce (ideally with a minimal diagram JSON that triggers the issue)
- Browser and OS version

---

## Proposing features

Open a GitHub Issue before starting implementation. Describe:

- The problem being solved
- Proposed solution and any alternatives considered
- Academic impact (does it help teachers, students, or both?)

Wait for a maintainer response before writing code for large features.

---

## Development setup

```bash
# Fork and clone
git clone https://github.com/<your-fork>/derup.git
cd derup

# Install dependencies
npm install

# Start AI proxy and frontend in separate terminals
npm run api
npm run dev
```

Open `http://127.0.0.1:5173`.

---

## Code conventions

### TypeScript
- `strict: true` is enforced — no exceptions.
- No `any`. Use `unknown` + type guard where the type is dynamic.
- Define prop types inline with the component.

### React
- Functional components only. No class components.
- Hooks follow the `use` prefix convention.

### Styling
- CSS custom properties for theming. No hardcoded color values.
- No inline styles for layout — use class names.

### General
- No unnecessary dependencies. If a utility is simple enough to write inline, do that.
- Keep `chatParser.ts` and `aiCommands.ts` decoupled: the parser produces commands; the command module applies them.
- Never hardcode API keys or secrets anywhere in the source.

---

## Testing

Run the full test suite before opening a PR:

```bash
npm run test
```

All 204 tests must pass. New functionality requires new tests.

Test file naming: `<unit>.test.ts` co-located with the file under test.

Test name format: describe what is tested, under what condition, and what the expected result is.

```ts
it('adds an entity when the command is "agregar entidad"', () => { ... });
it('returns empty array when diagram has no nodes', () => { ... });
```

Do not mock what can be tested directly. The test suite uses `jsdom` for DOM-dependent tests and does not mock the diagram state logic.

---

## Commit style

- Imperative mood, present tense: `add`, `fix`, `remove`, not `added` or `fixes`.
- First line under 72 characters.
- One logical change per commit.
- Do not bundle unrelated changes.

Examples:
```
add SQL DDL view with copy-to-clipboard
fix weak entity PK derivation for composite partial keys
remove unused dependency from package.json
```

---

## Pull request process

1. Create a branch from `main` with a descriptive name (`fix/weak-entity-pk`, `feat/sql-view`, etc.).
2. Implement the change with tests.
3. Verify locally:
   ```bash
   npm run lint
   npm run build
   npm run test
   ```
4. Open a PR against `main`. Include:
   - Summary of what changed and why
   - Steps to test manually
   - Screenshots or a screen recording for UI changes

PRs that break `npm run build` or reduce the passing test count will not be merged.

---

## Code of conduct

- Be direct and specific in reviews. Point to lines; propose alternatives.
- No personal criticism. Critique the code, not the author.
- Maintainers have final say on scope and design decisions.
- Security issues: report privately via GitHub security advisories, not public issues.
