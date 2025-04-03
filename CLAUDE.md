# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- `yarn build` - Build the entire application
- `yarn build:renderer` - Build just the renderer
- `yarn build:preload` - Build just the preload script
- `yarn start` - Build and start the application
- `yarn copy-static` - Copy static assets to dist directory

## Code Style Guidelines
- **Imports**: Order imports with Node.js/Electron modules first, then external modules, then local imports
- **TypeScript**: Use strict typing with interfaces defined in interfaces.ts
- **Formatting**: Use 4-space indentation
- **Naming**: Use camelCase for variables/functions, PascalCase for interfaces/types
- **Error Handling**: Use try/catch blocks with error logging to console
- **Constants**: Define application constants in constants.ts
- **Components**: Create standalone modules with clear separation of concerns
- **Comments**: Add comments for complex logic and non-obvious behavior
- **Promises**: Use async/await for asynchronous operations
- **File Organization**: Keep related functionality in dedicated files