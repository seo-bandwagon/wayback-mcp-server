# Contributing to Wayback MCP Server

Thank you for your interest in contributing!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run in dev mode: `npm run dev`

## Code Style

- TypeScript strict mode is enabled
- Use Zod for runtime validation
- Follow existing patterns in the codebase
- Add JSDoc comments for public APIs

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run build` succeeds
4. Update documentation if needed
5. Submit a pull request

## Reporting Issues

- Check existing issues first
- Include Node.js version
- Include steps to reproduce
- Include error messages/logs

## Rate Limiting Policy

When contributing features that make API calls:
- Respect the conservative rate limits
- Add appropriate caching
- Never bypass rate limiting
