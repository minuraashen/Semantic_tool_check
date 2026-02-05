# Custom Plugins Directory

Place custom artifact plugins here. Each plugin should be a `.plugin.ts` or `.plugin.js` file that exports an `ArtifactPlugin` interface.

## Plugin Interface

```typescript
interface ArtifactPlugin {
  id: string;                    // Unique identifier
  rootTags: string[];            // XML root tags that identify this type
  semanticBoundaries: string[];  // Tags that create chunk boundaries
  mediatorTags?: string[];       // Mediator-specific tags
  atomicTags?: string[];         // Tags that should not be split
  extractMetadata: (rootTag: string, attrs: Record<string, string>, parsed?: any) => ArtifactMetadata;
}
```

## Example Plugin

See `example-custom-mediator.plugin.ts` for a working example.
