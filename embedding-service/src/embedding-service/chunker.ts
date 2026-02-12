import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { computeChunkHash } from '../db/merkle';
import { ArtifactRegistry, artifactRegistry, ArtifactMetadata } from './artifact-registry';
import { config } from '../config';

/**
 * Semantic, Hierarchical, Structure-Aware XML Chunker for WSO2 MI artifacts
 * 
 * Uses plugin-based ArtifactRegistry for extensible artifact detection.
 */

export interface XMLChunk {
  filePath: string;
  resourceName: string;
  resourceType: string;
  chunkType: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  parentChunkId: number | null;
  embeddingText: string;
  semanticType: string;
  semanticIntent: string;
  contentHash: string;
  context: SemanticContext;
  sequenceKey?: string;
  isSequenceDefinition?: boolean;
  referencedSequences?: string[];
}

/**
 * Semantic context with flexible artifact metadata
 * Uses Record type to support any artifact type from registry
 */
export interface SemanticContext {
  // Common context types
  api?: {
    name?: string;
    context?: string;
    xmlns?: string;
  };
  resource?: {
    method?: string;
    uriTemplate?: string;
  };
  sequence?: string | {
    name?: string;
    xmlns?: string;
  };
  // Generic artifact context (for any plugin-provided artifacts)
  artifact?: {
    type: string;
    name: string;
    xmlns?: string;
    [key: string]: any;
  };
  // Data service components
  query?: {
    id?: string;
    useConfig?: string;
  };
  operation?: {
    name?: string;
    callsQuery?: string;
  };
  references?: string[];
  // Allow dynamic extension
  [key: string]: any;
}

interface LineRange {
  start: number;
  end: number;
}

export class XMLChunker {
  private chunkCounter = 0;
  private lastSearchPosition: number = 0;
  private readonly maxTokens: number;
  private embedder: any;
  private registry: ArtifactRegistry;

  constructor(embedder?: any, registry?: ArtifactRegistry) {
    this.embedder = embedder;
    this.registry = registry || artifactRegistry;
    this.maxTokens = config.maxTokens; // Default: 256
  }

  async chunkFile(filePath: string): Promise<XMLChunk[]> {
    this.chunkCounter = 0;
    this.lastSearchPosition = 0;
    const xmlContent = await fs.promises.readFile(filePath, 'utf-8');
    const lines = xmlContent.split('\n');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      preserveOrder: true,
      alwaysCreateTextNode: false,
    });

    const parsed = parser.parse(xmlContent);
    const chunks: XMLChunk[] = [];

    // Detect artifact type using registry
    const rootContext = this.buildRootContext(parsed, filePath);

    this.processNode(parsed, lines, filePath, chunks, null, rootContext);

    return chunks;
  }

  /**
   * Build root context by detecting artifact type from XML
   * Uses registry instead of path-based detection
   */
  private buildRootContext(parsed: any, filePath: string): SemanticContext {
    const context: SemanticContext = {};

    // Try to detect artifact type from XML structure
    const detected = this.registry.detectArtifactType(parsed);

    if (detected) {
      const { metadata } = detected;

      // Map to appropriate context structure based on type
      switch (metadata.type) {
        case 'api':
          context.api = {
            name: metadata.name,
            context: metadata.additionalInfo?.context,
            xmlns: metadata.xmlns,
          };
          break;
        case 'proxyService':
          context.artifact = {
            type: 'proxyService',
            name: metadata.name,
            transports: metadata.additionalInfo?.transports,
            xmlns: metadata.xmlns,
          };
          break;
        case 'sequence':
          context.sequence = {
            name: metadata.name,
            xmlns: metadata.xmlns,
          };
          break;
        default:
          // Generic artifact context for all other types
          context.artifact = {
            type: metadata.type,
            name: metadata.name,
            xmlns: metadata.xmlns,
            ...metadata.additionalInfo,
          };
          break;
      }
    } else {
      // Fallback: detect any artifact (including custom/unregistered types)
      // Pass filePath to infer type from folder structure
      const anyArtifact = this.registry.detectAnyArtifact(parsed, filePath);
      if (anyArtifact) {
        context.artifact = {
          type: anyArtifact.type,
          name: anyArtifact.name,
          xmlns: anyArtifact.xmlns,
          ...anyArtifact.additionalInfo,
        };
      } else {
        // Ultimate fallback if parsing completely fails
        context.artifact = {
          type: 'unknown',
          name: 'unknown',
        };
      }
    }

    return context;
  }

  /**
   * SEMANTIC BOUNDARY DETECTION (Registry-Based)
   * 
   * Queries the artifact registry instead of hardcoded lists.
   * Falls back to heuristics for unknown tags.
   */
  private isSemanticBoundary(tagName: string, attrs: Record<string, string> = {}): boolean {
    // Query registry for known boundaries
    if (this.registry.isSemanticBoundary(tagName)) {
      return true;
    }

    // Heuristic fallback for unknown tags:
    // Tags with identifying attributes suggest semantic units
    const attrCount = Object.keys(attrs).filter(k => !k.startsWith('#')).length;
    return attrCount > 0;
  }

  /**
   * Check if tag is a resource type (uses registry)
   */
  private isResourceType(tagName: string): boolean {
    return this.registry.isResourceType(tagName);
  }

  /**
   * Check if tag is a mediator type (uses registry)
   */
  private isMediatorType(tagName: string): boolean {
    // Query registry
    if (this.registry.isMediatorTag(tagName)) {
      return true;
    }
    // Heuristic: http.* patterns are mediators
    return tagName.startsWith('http.');
  }


  /**
   * Extract cross-artifact references from a chunk's XML content.
   * Detects: sequence key, configKey (local entries), endpoint key,
   *          call-template target, useConfig (data service), call-query href.
   */
  private extractReferencesFromContent(content: string): string[] {
    const refs = new Set<string>();
    let match;

    // <sequence key="Name"/> → sequence reference
    const sequenceRefPattern = /<sequence\s+key=["']([^"']+)["']\s*\/>/g;
    while ((match = sequenceRefPattern.exec(content)) !== null) {
      refs.add(`sequence:${match[1]}`);
    }

    // configKey="Name" → local entry reference (used by http.post, email.send, etc.)
    const configKeyPattern = /configKey=["']([^"']+)["']/g;
    while ((match = configKeyPattern.exec(content)) !== null) {
      refs.add(`localEntry:${match[1]}`);
    }

    // <endpoint key="Name"/> → endpoint reference
    const endpointRefPattern = /<endpoint\s+key=["']([^"']+)["']\s*\/>/g;
    while ((match = endpointRefPattern.exec(content)) !== null) {
      refs.add(`endpoint:${match[1]}`);
    }

    // <call-template target="Name"/> → template reference
    const templateRefPattern = /<call-template\s+target=["']([^"']+)["']/g;
    while ((match = templateRefPattern.exec(content)) !== null) {
      refs.add(`template:${match[1]}`);
    }

    // useConfig="Name" → data service config reference
    const useConfigPattern = /useConfig=["']([^"']+)["']/g;
    while ((match = useConfigPattern.exec(content)) !== null) {
      refs.add(`config:${match[1]}`);
    }

    // <call-query href="Name"> → data service query reference
    const callQueryPattern = /<call-query\s+href=["']([^"']+)["']/g;
    while ((match = callQueryPattern.exec(content)) !== null) {
      refs.add(`query:${match[1]}`);
    }

    return Array.from(refs);
  }

  /**
   * EXCLUSIVE TOP-DOWN CHUNKING with token gating
   */
  private processNode(
    node: any,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
    if (!Array.isArray(node)) return;

    for (const item of node) {
      const tagName = Object.keys(item).find(key => key !== ':@') || '';
      if (!tagName) continue;

      // Skip XML declaration and other processing instructions
      if (tagName.startsWith('?xml')) continue;

      const element = item[tagName];
      const nodeAttrs = item[':@'] || {};

      // Update context based on node type
      const updatedContext = this.updateContext(tagName, nodeAttrs, context);

      // Check if this is a chunkable node
      const isChunkable = this.isResourceType(tagName) ||
        this.isSemanticBoundary(tagName, nodeAttrs) ||
        this.isMediatorType(tagName);

      if (isChunkable) {
        // Token gating: Check if subtree fits within limit
        const range = this.findElementRange(tagName, this.getNodeName(tagName, element), lines);
        const content = this.extractContent(lines, range);
        const metadata = this.formatMetadata(updatedContext);
        const tokenCount = this.countTokens(content, metadata);

        if (tokenCount <= this.maxTokens) {
          // Subtree fits → Emit chunk and STOP traversal
          this.createChunk(tagName, nodeAttrs, content, range, filePath, chunks, parentChunkId, updatedContext);
        } else {
          // Subtree too large → Do NOT chunk, descend to ALL children
          if (Array.isArray(element)) {
            this.processNode(element, lines, filePath, chunks, parentChunkId, updatedContext);
          }
        }
      } else if (Array.isArray(element)) {
        // Non-chunkable nodes → just traverse
        this.processNode(element, lines, filePath, chunks, parentChunkId, updatedContext);
      }
    }
  }

  /**
   * Update semantic context as we traverse the tree
   */
  private updateContext(tagName: string, attrs: Record<string, string>, parentContext: SemanticContext): SemanticContext {
    const newContext = { ...parentContext };

    if (tagName === 'api' || tagName === 'proxy') {
      newContext.api = {
        name: attrs.name || attrs['@_name'],
        context: attrs.context || attrs['@_context'],
        xmlns: attrs.xmlns || attrs['@_xmlns'],
      };
    } else if (tagName === 'resource') {
      newContext.resource = {
        method: attrs.methods || attrs['@_methods'],
        uriTemplate: attrs['uri-template'] || attrs['@_uri-template'] || attrs.uri || attrs['@_uri'],
      };
    } else if (tagName === 'inSequence' || tagName === 'outSequence' || tagName === 'faultSequence') {
      newContext.sequence = tagName;
    } else if (tagName === 'sequence' && (attrs.key || attrs['@_key'])) {
      newContext.sequence = attrs.key || attrs['@_key'];
    } else if (tagName === 'query') {
      newContext.query = {
        id: attrs.id || attrs['@_id'],
        useConfig: attrs.useConfig || attrs['@_useConfig'],
      };
    } else if (tagName === 'operation') {
      newContext.operation = {
        name: attrs.name || attrs['@_name'],
      };
    }

    return newContext;
  }

  /**
   * Create a chunk from the current node
   */
  private createChunk(
    tagName: string,
    attrs: Record<string, string>,
    content: string,
    range: LineRange,
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
    const resourceName = attrs.name || attrs['@_name'] || attrs.key || attrs['@_key'] ||
      attrs.context || attrs['@_context'] || tagName;
    const chunkIndex = this.chunkCounter++;

    const embeddingText = this.createEmbeddingText(tagName, resourceName, content, attrs, context);
    const semanticType = this.mapToSemanticType(tagName);
    const semanticIntent = this.inferIntent(tagName, attrs, content);
    const contentHash = computeChunkHash(content, {
      type: semanticType,
      intent: semanticIntent,
      context,
    });

    // Extract references from this chunk's content
    const chunkReferences = this.extractReferencesFromContent(content);
    if (chunkReferences.length > 0) {
      context.references = chunkReferences;
    }

    // Detect if this is a standalone artifact definition
    const standaloneTypes = ['sequence', 'localEntry', 'endpoint', 'template'];
    const isStandalone = standaloneTypes.includes(tagName);
    const sequenceKey = isStandalone ? (attrs.name || attrs['@_name'] || attrs.key || attrs['@_key']) : undefined;

    // For custom artifacts, use the type inferred from context (folder-based)
    // Otherwise, use registered resource types or fallback to path-based inference
    const resourceType = context.artifact?.type ||
      (this.isResourceType(tagName) ? tagName : this.getResourceType(filePath));

    chunks.push({
      filePath,
      resourceName,
      resourceType,
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText,
      semanticType,
      semanticIntent,
      contentHash,
      context: { ...context, references: chunkReferences.length > 0 ? chunkReferences : undefined },
      sequenceKey,
      isSequenceDefinition: isStandalone,
      referencedSequences: chunkReferences,
    });
  }

  /**
   * Map XML tag to semantic type (extensible via patterns)
   */
  private mapToSemanticType(tagName: string): string {
    if (tagName === 'resource') return 'resource';
    if (tagName === 'api' || tagName === 'proxy') return 'api';
    if (tagName.includes('Sequence') || tagName === 'sequence') return 'sequence';
    if (tagName === 'filter' || tagName === 'switch') return 'filter';
    if (tagName === 'payloadFactory') return 'payloadFactory';
    if (tagName === 'respond') return 'response';
    if (tagName === 'config') return 'dataConfig';
    if (tagName === 'query') return 'dataQuery';
    if (tagName === 'operation') return 'dataOperation';
    if (tagName === 'trigger') return 'trigger';
    if (tagName === 'property') return 'property';

    // Generic fallback
    return 'component';
  }

  /**
   * Infer semantic intent from tag and content
   */
  private inferIntent(tagName: string, attrs: Record<string, string>, content: string): string {
    if (tagName === 'filter' || tagName === 'switch') return 'validation';
    if (tagName === 'payloadFactory' || tagName === 'enrich') return 'transformation';
    if (tagName === 'call' || tagName === 'send' || tagName.startsWith('http.')) return 'delegation';
    if (tagName === 'respond') return 'response';
    if (tagName === 'faultSequence') return 'error-handling';
    if (tagName === 'query' || tagName === 'operation') return 'data-access';
    if (tagName === 'config' || tagName === 'property' || tagName === 'trigger') return 'configuration';

    return 'processing';
  }

  /**
   * Count tokens using the model's tokenizer
   */
  private countTokens(content: string, metadata: string = ''): any {
    const fullText = metadata + ' ' + content;

    if (this.embedder && this.embedder.countTokens) {
      return this.embedder.countTokens(fullText);
    }
    return 'hiiii'
    // Fallback to character approximation
    // return Math.ceil(fullText.length / 4);
  }

  /**
   * Extract node name from element attributes
   */
  private getNodeName(tagName: string, element: any): string {
    const attrs = this.extractAttributes(element);
    return attrs.name || attrs['@_name'] || attrs.key || attrs['@_key'] ||
      attrs.context || attrs['@_context'] || tagName;
  }

  /**
   * Format context metadata into text for token counting
   */
  private formatMetadata(context: SemanticContext): string {
    const parts: string[] = [];
    if (context.api?.name) parts.push(`API: ${context.api.name}`);
    if (context.api?.context) parts.push(`Context: ${context.api.context}`);
    if (context.resource?.method) parts.push(`Method: ${context.resource.method}`);
    if (context.resource?.uriTemplate) parts.push(`URI: ${context.resource.uriTemplate}`);
    if (context.sequence) {
      const seqName = typeof context.sequence === 'string' ? context.sequence : context.sequence.name;
      parts.push(`Sequence: ${seqName}`);
    }
    if (context.artifact?.name) parts.push(`${context.artifact.type}: ${context.artifact.name}`);
    if (context.query?.id) parts.push(`Query: ${context.query.id}`);
    if (context.operation?.name) parts.push(`Operation: ${context.operation.name}`);
    if (context.references && context.references.length > 0) {
      parts.push(`Uses: ${context.references.join(', ')}`);
    }
    return parts.join(' ');
  }

  private extractAttributes(element: any): Record<string, string> {
    const attrs: Record<string, string> = {};

    if (Array.isArray(element)) {
      for (const item of element) {
        if (item[':@']) {
          Object.assign(attrs, item[':@']);
          break;
        }
      }
    } else if (element && element[':@']) {
      Object.assign(attrs, element[':@']);
    }

    return attrs;
  }

  private findElementRange(tagName: string, resourceName: string, lines: string[]): LineRange {
    let startLine = -1;
    let endLine = -1;
    let depth = 0;

    for (let i = this.lastSearchPosition; i < lines.length; i++) {
      const line = lines[i];

      if (startLine === -1) {
        const openPattern = new RegExp(`<${tagName}[\\s>/]`);
        if (openPattern.test(line)) {
          startLine = i + 1;
          this.lastSearchPosition = i + 1;

          if (line.includes('/>')) {
            endLine = i + 1;
            break;
          }
          depth = 1;
        }
      } else {
        const openPattern = new RegExp(`<${tagName}[\\s>]`);
        const closePattern = new RegExp(`</${tagName}>`);

        if (openPattern.test(line) && !line.includes('/>')) {
          depth++;
        }
        if (closePattern.test(line)) {
          depth--;
          if (depth === 0) {
            endLine = i + 1;
            break;
          }
        }
      }
    }

    if (startLine === -1) startLine = 1;
    if (endLine === -1) endLine = startLine;

    return { start: startLine, end: endLine };
  }

  private extractContent(lines: string[], range: LineRange): string {
    return lines.slice(range.start - 1, range.end).join('\n');
  }

  private getResourceType(filePath: string): string {
    if (filePath.includes('/apis/')) return 'api';
    if (filePath.includes('/sequences/')) return 'sequence';
    if (filePath.includes('/proxy-services/')) return 'proxy';
    if (filePath.includes('/endpoints/')) return 'endpoint';
    if (filePath.includes('/local-entries/')) return 'localEntry';
    if (filePath.includes('/templates/')) return 'template';
    if (filePath.includes('/data-services/')) return 'dataService';
    if (filePath.includes('/data-sources/')) return 'dataSource';
    if (filePath.includes('/tasks/')) return 'task';
    if (filePath.includes('/message-stores/')) return 'messageStore';
    if (filePath.includes('/message-processors/')) return 'messageProcessor';
    if (filePath.includes('/inbound-endpoints/')) return 'inboundEndpoint';
    return 'unknown';
  }


  /**
   * Create natural text representation for embedding
   * Format: [JSON Context] + [Cleaned XML Content]
   * 
   * Example:
   *   Context: {"api":{"name":"BankAPI","context":"/bankapi"},"resource":{"method":"GET","uriTemplate":"/"}}
   *   Content: <payloadFactory><format>{"greeting":"Hello"}</format></payloadFactory>
   *   → {"api":{"name":"BankAPI","context":"/bankapi"},"resource":{"method":"GET"}} payloadFactory format greeting Hello
   */
  private createEmbeddingText(
    tagName: string,
    resourceName: string,
    content: string,
    attrs: Record<string, string>,
    context: SemanticContext
  ): string {

    //  // Start with JSON context for structured representation
    //   const contextStr = JSON.stringify(context);

    // Start with formatted context metadata as text
    const contextStr = this.formatMetadata(context);
    const tokens: string[] = contextStr ? [contextStr] : [];

    // Comprehensive XML preprocessing: Remove all angle brackets and create natural text
    const cleanedContent = content
      // Extract tag names and attributes from opening tags: <tag attr="val"> → tag attr="val"
      .replace(/<([^>\/\s]+)([^>]*)>/g, ' $1 $2 ')
      // Remove closing tags: </tag> → (empty)
      .replace(/<\/[^>]+>/g, ' ')
      // Extract from self-closing tags: <tag attr="val"/> → tag attr="val"
      .replace(/<([^>\/\s]+)([^>]*)\s*\/>/g, ' $1 $2 ')
      // Clean up attribute formatting: attr="value" → attr=value
      .replace(/="([^"]*)"/g, '=$1')
      .replace(/='([^']*)'/g, '=$1')
      // Remove remaining special characters but preserve $, {, }, [, ] for expressions and paths
      .replace(/[^\w\s=\$\{\}\[\]\/\-\.,:@]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // Split into meaningful tokens
    const contentTokens = cleanedContent
      .split(/\s+/)
      .filter(t => t.length > 1 && t.length < 100); // Allow longer tokens for expressions like ${payload.userId}

    tokens.push(...contentTokens);

    // Increased limit from 150 to 200 for better context representation
    return tokens.slice().join(' ');
  }
}
