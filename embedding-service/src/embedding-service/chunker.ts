import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

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
}

interface LineRange {
  start: number;
  end: number;
}

export class XMLChunker {
  private chunkCounter = 0;

  async chunkFile(filePath: string): Promise<XMLChunk[]> {
    this.chunkCounter = 0;
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

    this.processNode(parsed, xmlContent, lines, filePath, chunks, null);
    
    return chunks;
  }

  private processNode(
    node: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null
  ): void {
    if (!Array.isArray(node)) return;

    for (const item of node) {
      const tagName = Object.keys(item)[0];
      const element = item[tagName];

      if (this.isResourceType(tagName)) {
        this.chunkResource(tagName, element, xmlContent, lines, filePath, chunks, parentChunkId);
      } else if (this.isSequenceType(tagName)) {
        this.chunkSequence(tagName, element, xmlContent, lines, filePath, chunks, parentChunkId);
      } else if (this.isMediatorType(tagName)) {
        this.chunkMediator(tagName, element, xmlContent, lines, filePath, chunks, parentChunkId);
      } else if (Array.isArray(element)) {
        this.processNode(element, xmlContent, lines, filePath, chunks, parentChunkId);
      }
    }
  }

  private chunkResource(
    tagName: string,
    element: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null
  ): void {
    const attrs = this.extractAttributes(element);
    const resourceName = attrs.name || attrs.context || tagName;
    const range = this.findElementRange(tagName, resourceName, lines);
    
    const chunkIndex = this.chunkCounter++;
    const content = this.extractContent(lines, range);
    
    chunks.push({
      filePath,
      resourceName,
      resourceType: tagName,
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText: this.createEmbeddingText(tagName, resourceName, content, attrs),
    });

    const currentChunkId = chunkIndex;

    if (Array.isArray(element)) {
      this.processNode(element, xmlContent, lines, filePath, chunks, currentChunkId);
    }
  }

  private chunkSequence(
    tagName: string,
    element: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null
  ): void {
    const attrs = this.extractAttributes(element);
    const resourceName = attrs.key || attrs.name || tagName;
    const range = this.findElementRange(tagName, resourceName, lines);
    
    const chunkIndex = this.chunkCounter++;
    const content = this.extractContent(lines, range);
    
    chunks.push({
      filePath,
      resourceName,
      resourceType: this.getResourceType(filePath),
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText: this.createEmbeddingText(tagName, resourceName, content, attrs),
    });

    const currentChunkId = chunkIndex;

    if (Array.isArray(element)) {
      this.processNode(element, xmlContent, lines, filePath, chunks, currentChunkId);
    }
  }

  private chunkMediator(
    tagName: string,
    element: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null
  ): void {
    const attrs = this.extractAttributes(element);
    const resourceName = attrs.name || attrs.key || tagName;
    const range = this.findElementRange(tagName, resourceName, lines);
    
    const chunkIndex = this.chunkCounter++;
    const content = this.extractContent(lines, range);
    
    chunks.push({
      filePath,
      resourceName,
      resourceType: this.getResourceType(filePath),
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText: this.createEmbeddingText(tagName, resourceName, content, attrs),
    });
  }

  private isResourceType(tagName: string): boolean {
    return ['api', 'proxy', 'sequence', 'endpoint', 'localEntry', 'resource'].includes(tagName);
  }

  private isSequenceType(tagName: string): boolean {
    return ['inSequence', 'outSequence', 'faultSequence'].includes(tagName);
  }

  private isMediatorType(tagName: string): boolean {
    const mediators = [
      'log', 'payloadFactory', 'property', 'variable', 'filter', 'respond',
      'call', 'send', 'drop', 'enrich', 'switch', 'clone', 'iterate',
      'aggregate', 'cache', 'throttle', 'validate', 'xslt', 'script',
      'http.post', 'http.get', 'http.put', 'http.delete', 'http.patch'
    ];
    return mediators.includes(tagName);
  }

  private extractAttributes(element: any): Record<string, string> {
    const attrs: Record<string, string> = {};
    
    if (!Array.isArray(element)) return attrs;
    
    for (const item of element) {
      if (item[':@']) {
        Object.assign(attrs, item[':@']);
      }
    }
    
    return attrs;
  }

  private findElementRange(tagName: string, resourceName: string, lines: string[]): LineRange {
    let startLine = -1;
    let endLine = -1;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (startLine === -1) {
        const openPattern = new RegExp(`<${tagName}[\\s>]`);
        if (openPattern.test(line)) {
          startLine = i + 1;
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
    return 'unknown';
  }

  private createEmbeddingText(
    tagName: string,
    resourceName: string,
    content: string,
    attrs: Record<string, string>
  ): string {
    const tokens: string[] = [tagName, resourceName];

    for (const [key, value] of Object.entries(attrs)) {
      if (key !== 'xmlns' && !key.startsWith('xmlns:')) {
        tokens.push(key, value);
      }
    }

    const contentTokens = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && t.length < 50);

    tokens.push(...contentTokens);

    return tokens.slice(0, 150).join(' ');
  }
}
