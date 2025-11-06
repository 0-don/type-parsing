# Project Architecture

## Directory Structure

```
src/
├── extension.ts                    # Main extension entry point
├── types.ts                        # Shared type definitions
├── parsers/
│   └── template-literal-parser.ts  # Parse template literals & generate combinations
├── resolvers/
│   ├── import-resolver.ts          # Resolve import paths to file URIs
│   ├── value-extractor.ts          # Extract values from TS declarations
│   └── variable-resolver.ts        # Main variable resolution logic
└── utils/
    ├── decoration-builder.ts       # Build VSCode decorations
    └── typescript-helpers.ts       # TypeScript AST utilities
```

## Module Overview

### [extension.ts](src/extension.ts)
Main extension lifecycle management. Handles editor events and schedules decoration updates.

### [types.ts](src/types.ts)
- `TemplatePart`: Static or variable part of a template literal
- `TemplateLiteralPosition`: Position information for template literals

### Parsers

#### [template-literal-parser.ts](src/parsers/template-literal-parser.ts)
- `findTemplateLiterals()`: Find all template literals in a document
- `generateCombinations()`: Generate string combinations from template parts

### Resolvers

#### [import-resolver.ts](src/resolvers/import-resolver.ts)
- `resolveImportPath()`: Resolve relative imports with extension handling (.ts, .tsx, .js, etc.)

#### [value-extractor.ts](src/resolvers/value-extractor.ts)
- `extractValuesFromDeclaration()`: Extract values from enums, type aliases, and variables
- `resolvePropertyValue()`: Resolve property values from object literals

#### [variable-resolver.ts](src/resolvers/variable-resolver.ts)
- `resolveVariable()`: Main entry point using multiple strategies:
  - VSCode hover provider for type info
  - Language server (type definition, definition providers)
  - Local scope analysis
  - Import resolution

### Utils

#### [decoration-builder.ts](src/utils/decoration-builder.ts)
- `buildDecorations()`: Build VSCode decorations for template literals
- Groups by line position and resolves all variable values

#### [typescript-helpers.ts](src/utils/typescript-helpers.ts)
TypeScript AST manipulation utilities:
- `findDeclarationInFile()`: Find declarations by name
- `findImportDeclaration()`: Find import statements
- `findExportedDeclaration()`: Find exported declarations
- `findNodeAtPosition()`: Find AST node at position
- `extractStringLiteralsFromType()`: Extract string literals from union types

## Data Flow

1. **Activation**: Setup decoration type and event listeners
2. **Discovery**: Parse document to find template literals
3. **Resolution**: Resolve variables using language server → AST analysis → imports
4. **Generation**: Generate all possible string combinations
5. **Display**: Apply decorations as inline comments

## Adding New Features

- **Resolution strategy** → [variable-resolver.ts](src/resolvers/variable-resolver.ts)
- **AST utilities** → [typescript-helpers.ts](src/utils/typescript-helpers.ts)
- **Decoration logic** → [decoration-builder.ts](src/utils/decoration-builder.ts)
- **Types** → [types.ts](src/types.ts)
