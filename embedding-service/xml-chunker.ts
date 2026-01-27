/**
 * XML Parsing and Chunking Operations
 * Handles semantic chunking of WSO2 Micro Integrator XML configuration files
 */

import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

/**
 * Information about a code chunk extracted from XML
 */
export interface ChunkInfo {
  elementType: string; // "proxy", "api", "sequence", etc.
  elementName: string; // Value of "name" attribute
  startLine: number;
  endLine: number;
  filePath: string;
  embeddingText: string; // Text representation for embedding generation
}

/**
 * XMLCodeChunker class for semantic chunking of WSO2 MI XML files
 * Extracts meaningful semantic chunks from XML configuration files
 */
export class XMLCodeChunker {
  // WSO2 MI element types to extract
  private static readonly TARGET_ELEMENTS = [
    'proxy',
    'api',
    'sequence',
    'endpoint',
    'localEntry',
    'resource',
    'inSequence',
    'outSequence',
  ];

  /**
   * Chunks an XML file into semantic units
   * @param filePath - Absolute path to the XML file
   * @returns Array of ChunkInfo objects
   */
  async chunkFile(filePath: string): Promise<ChunkInfo[]> {
    try {
      // Read XML file content
      const xmlContent = await fs.promises.readFile(filePath, 'utf-8');

      // Parse XML to object structure
      const parsedXML = this.parseXML(xmlContent);

      // Extract elements and create chunks
      const chunks = this.extractElements(parsedXML, filePath, xmlContent);

      console.log(`Extracted ${chunks.length} chunks from ${filePath}`);
      return chunks;
    } catch (error) {
      console.warn(`Failed to chunk XML file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Parses XML content into a JavaScript object
   * @param xmlContent - Raw XML string
   * @returns Parsed XML object
   */
  private parseXML(xmlContent: string): any {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        textNodeName: '_text',
        ignoreNameSpace: true, // Strip namespace prefixes
        parseAttributeValue: false,
        trimValues: true,
      });

      return parser.parse(xmlContent);
    } catch (error) {
      console.error('XML parsing failed:', error);
      throw new Error(`XML parsing error: ${error}`);
    }
  }

  /**
   * Extracts target WSO2 MI elements from parsed XML
   * @param parsedXML - Parsed XML object
   * @param filePath - Original file path
   * @param xmlContent - Original XML content for line number calculation
   * @returns Array of ChunkInfo objects
   */
  private extractElements(parsedXML: any, filePath: string, xmlContent: string): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];

    // Traverse the XML structure to find target elements
    const traverse = (node: any, elementType?: string) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      // Check if current node is a target element
      for (const targetElement of XMLCodeChunker.TARGET_ELEMENTS) {
        if (node[targetElement]) {
          const elements = Array.isArray(node[targetElement])
            ? node[targetElement]
            : [node[targetElement]];

          for (const element of elements) {
            // Extract element name from name, key, or context attribute
            const elementName =
              element.name || element.key || element.context || targetElement;

            // Calculate line numbers in original XML
            const lineNumbers = this.calculateLineNumbers(
              xmlContent,
              elementName,
              targetElement
            );

            // Generate embedding text
            const embeddingText = this.createEmbeddingText(element, targetElement, elementName);

            chunks.push({
              elementType: targetElement,
              elementName,
              startLine: lineNumbers.start,
              endLine: lineNumbers.end,
              filePath,
              embeddingText,
            });
          }
        }
      }

      // Recursively traverse child nodes
      for (const key in node) {
        if (typeof node[key] === 'object') {
          traverse(node[key], key);
        }
      }
    };

    traverse(parsedXML);
    return chunks;
  }

  /**
   * Creates a text representation for embedding generation
   * Combines element type, name, child elements, and important attributes
   * @param element - XML element object
   * @param elementType - Type of element (proxy, api, etc.)
   * @param elementName - Name of the element
   * @returns Concise text representation
   */
  private createEmbeddingText(element: any, elementType: string, elementName: string): string {
    const tokens: string[] = [];

    // Add element type and name
    tokens.push(elementType);
    tokens.push(elementName);

    // Extract important attributes and child element types
    const extractTokens = (node: any, depth: number = 0) => {
      if (depth > 3 || !node || typeof node !== 'object') {
        return; // Limit depth to avoid too much detail
      }

      for (const key in node) {
        const value = node[key];

        // Skip certain technical attributes
        if (key.startsWith('$') || key.startsWith('xmlns') || key === '_') {
          continue;
        }

        // Add key as token (tag name or attribute name)
        tokens.push(key);

        // If value is a simple string and meaningful, add it
        if (typeof value === 'string' && value.length < 100) {
          // Extract meaningful parts from URLs and paths
          const meaningfulValue = value
            .replace(/https?:\/\//g, '')
            .replace(/[/:]/g, ' ')
            .trim();

          if (meaningfulValue) {
            tokens.push(...meaningfulValue.split(/\s+/).filter(t => t.length > 0));
          }
        } else if (typeof value === 'object') {
          // Recursively extract from child objects
          extractTokens(value, depth + 1);
        }
      }
    };

    extractTokens(element);

    // Remove duplicates and join with spaces
    const uniqueTokens = [...new Set(tokens)];

    // Limit to reasonable length (50-200 words)
    const embeddingText = uniqueTokens.slice(0, 200).join(' ');

    return embeddingText;
  }

  /**
   * Calculates start and end line numbers for an element in the original XML
   * @param xmlContent - Original XML content
   * @param elementName - Name of the element to find
   * @param elementType - Type of element (proxy, api, etc.)
   * @returns Object with start and end line numbers
   */
  private calculateLineNumbers(
    xmlContent: string,
    elementName: string,
    elementType: string
  ): { start: number; end: number } {
    try {
      // Escape special regex characters in element name
      const escapedName = elementName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Create regex patterns to find opening and closing tags
      // Pattern matches: <elementType ... name="elementName" ... > or <elementType ... name='elementName' ... >
      const openTagPattern = new RegExp(
        `<${elementType}[^>]*(?:name|key|context)=['"]${escapedName}['"][^>]*>`,
        'i'
      );

      // Also try without name attribute for cases where element name is the tag itself
      const simpleOpenTagPattern = new RegExp(`<${elementType}[^>]*>`, 'i');

      const closeTagPattern = new RegExp(`</${elementType}>`, 'i');

      // Find opening tag
      let openMatch = xmlContent.match(openTagPattern);
      if (!openMatch) {
        openMatch = xmlContent.match(simpleOpenTagPattern);
      }

      if (!openMatch || openMatch.index === undefined) {
        // Fallback: return line 1
        return { start: 1, end: 1 };
      }

      // Calculate start line by counting newlines before the match
      const beforeOpen = xmlContent.substring(0, openMatch.index);
      const startLine = beforeOpen.split('\n').length;

      // Find closing tag after the opening tag
      const afterOpen = xmlContent.substring(openMatch.index + openMatch[0].length);
      const closeMatch = afterOpen.match(closeTagPattern);

      if (!closeMatch || closeMatch.index === undefined) {
        // Self-closing or parsing issue
        return { start: startLine, end: startLine };
      }

      // Calculate end line
      const beforeClose = xmlContent.substring(
        0,
        openMatch.index + openMatch[0].length + closeMatch.index + closeMatch[0].length
      );
      const endLine = beforeClose.split('\n').length;

      return { start: startLine, end: endLine };
    } catch (error) {
      console.warn(`Failed to calculate line numbers for ${elementType} ${elementName}:`, error);
      return { start: 1, end: 1 };
    }
  }
}