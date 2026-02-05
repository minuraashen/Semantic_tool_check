/**
 * Example Custom Mediator Plugin
 * 
 * This demonstrates how to add support for a custom WSO2 MI artifact type.
 * Copy this file and modify for your specific artifact.
 */

import { ArtifactPlugin, ArtifactMetadata } from '../src/embedding-service/artifact-registry';

const customMediatorPlugin: ArtifactPlugin = {
    id: 'customMediator',

    // XML root tags that identify this artifact type
    rootTags: ['customMediator'],

    // Tags within this artifact that should create chunk boundaries
    semanticBoundaries: ['transform', 'validate', 'enrich'],

    // Mediator tags (optional)
    mediatorTags: ['customLog', 'customTransform'],

    // Tags that should not be split further
    atomicTags: ['customPayload'],

    // Extract metadata from the parsed XML
    extractMetadata: (rootTag: string, attrs: Record<string, string>): ArtifactMetadata => ({
        type: 'customMediator',
        name: attrs.name || attrs['@_name'] || 'unknown',
        xmlns: attrs.xmlns || attrs['@_xmlns'],
        additionalInfo: {
            version: attrs.version || attrs['@_version']
        }
    })
};

export default customMediatorPlugin;
