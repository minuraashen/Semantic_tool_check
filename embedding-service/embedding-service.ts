/**
 * Core Embedding Service Operations
 * Orchestrates the entire embedding workflow including model loading,
 * XML chunking, embedding generation, vector storage, and similarity search
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ort from 'onnxruntime-node';
import { XMLCodeChunker, ChunkInfo } from './xml-chunker';
import { VectorStore, ChunkMetadata } from './vector-store';

/**
 * Result from similarity search
 */
export interface SearchResult {
  id: number;
  filePath: string;
  startLine: number;
  endLine: number;
  elementType: string;
  elementName: string;
  similarityScore: number;
}

/**
 * EmbeddingService class - Singleton orchestrator for embedding workflow
 * Manages ONNX model, XML chunking, vector storage, and search operations
 */
class EmbeddingService {
  private static instance: EmbeddingService;
  
  private session: ort.InferenceSession | null = null;
  private vectorStore: VectorStore | null = null;
  private chunker: XMLCodeChunker;
  private workspacePath: string = '';
  private isInitialized: boolean = false;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    this.chunker = new XMLCodeChunker();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initializes the embedding service
   * @param workspacePath - Root path of the workspace to index
   * @param dbPath - Path to SQLite database file
   */
  async start(workspacePath: string, dbPath: string): Promise<void> {
    try {
      console.log('Starting EmbeddingService...');
      
      // Load ONNX model
      const modelPath = path.join(__dirname, 'models', 'model_quantized.onnx');
      console.log(`Loading ONNX model from: ${modelPath}`);
      
      if (!fs.existsSync(modelPath)) {
        throw new Error(`Model file not found at: ${modelPath}`);
      }
      
      this.session = await ort.InferenceSession.create(modelPath);
      console.log('ONNX model loaded successfully');
      
      // Initialize VectorStore
      this.vectorStore = new VectorStore(dbPath);
      console.log('VectorStore initialized');
      
      // Store workspace path
      this.workspacePath = workspacePath;
      
      this.isInitialized = true;
      console.log(`EmbeddingService initialized for workspace: ${workspacePath}`);
    } catch (error) {
      console.error('Failed to start EmbeddingService:', error);
      throw new Error(`EmbeddingService initialization failed: ${error}`);
    }
  }

  /**
   * Indexes all XML files in the workspace
   */
  async indexWorkspace(): Promise<void> {
    this.ensureInitialized();
    
    try {
      console.log('Starting workspace indexing...');
      
      // Find all XML files recursively
      const xmlFiles = await this.findXMLFiles(this.workspacePath);
      console.log(`Found ${xmlFiles.length} XML files to index`);
      
      let processedFiles = 0;
      let totalChunks = 0;
      
      // Index each file
      for (const filePath of xmlFiles) {
        try {
          const chunks = await this.indexFile(filePath);
          processedFiles++;
          totalChunks += chunks;
          console.log(`Progress: ${processedFiles}/${xmlFiles.length} files, ${totalChunks} total chunks`);
        } catch (error) {
          console.warn(`Failed to index file ${filePath}:`, error);
          // Continue with other files
        }
      }
      
      console.log(`Workspace indexing complete: ${processedFiles} files processed, ${totalChunks} chunks created`);
    } catch (error) {
      console.error('Workspace indexing failed:', error);
      throw error;
    }
  }

  /**
   * Indexes a single XML file
   * @param filePath - Absolute path to the XML file
   * @returns Number of chunks created
   */
  async indexFile(filePath: string): Promise<number> {
    this.ensureInitialized();
    
    try {
      // Check file modification time
      const stats = await fs.promises.stat(filePath);
      const lastModified = stats.mtimeMs;
      
      // Check if file needs reindexing
      const existingChunks = this.vectorStore!.getAllEmbeddings().filter(
        item => item.metadata.filePath === filePath
      );
      
      if (existingChunks.length > 0 && existingChunks[0].metadata.lastModified >= lastModified) {
        console.log(`Skipping unchanged file: ${filePath}`);
        return 0;
      }
      
      // Delete existing chunks
      if (existingChunks.length > 0) {
        await this.deleteFileChunks(filePath);
      }
      
      // Chunk the file
      const chunks = await this.chunker.chunkFile(filePath);
      
      if (chunks.length === 0) {
        console.warn(`No chunks extracted from ${filePath}`);
        return 0;
      }
      
      // Generate embeddings and store
      for (const chunk of chunks) {
        try {
          const embedding = await this.generateEmbedding(chunk.embeddingText);
          
          const metadata: ChunkMetadata = {
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            elementType: chunk.elementType,
            elementName: chunk.elementName,
            lastModified: lastModified,
          };
          
          this.vectorStore!.insertChunk(metadata, embedding);
        } catch (error) {
          console.warn(`Failed to generate embedding for chunk in ${filePath}:`, error);
          // Continue with other chunks
        }
      }
      
      console.log(`Indexed ${chunks.length} chunks from ${filePath}`);
      return chunks.length;
    } catch (error) {
      console.warn(`Failed to index file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Deletes all chunks associated with a file
   * @param filePath - Absolute path to the file
   */
  async deleteFileChunks(filePath: string): Promise<void> {
    this.ensureInitialized();
    
    try {
      this.vectorStore!.deleteChunksByFile(filePath);
      console.log(`Deleted chunks for file: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete chunks for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Generates an embedding vector for the given text
   * @param text - Input text to embed
   * @returns 384-dimensional embedding vector
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    this.ensureInitialized();
    
    try {
      // Simple tokenization (whitespace split)
      // In production, use proper tokenizer like transformers.js
      const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
      
      // Create a simple numeric representation
      // This is a placeholder - actual tokenization would map to vocabulary indices
      const maxLength = 128;
      const tokenIds = new Array(maxLength).fill(0);
      
      for (let i = 0; i < Math.min(tokens.length, maxLength); i++) {
        // Simple hash to token ID (placeholder)
        tokenIds[i] = this.hashString(tokens[i]) % 30000;
      }
      
      // Create input tensors
      const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(id => BigInt(id))), [1, maxLength]);
      const attentionMask = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(id => id > 0 ? BigInt(1) : BigInt(0))), [1, maxLength]);
      
      // Run inference
      const feeds = {
        input_ids: inputIds,
        attention_mask: attentionMask,
      };
      
      const results = await this.session!.run(feeds);
      
      // Extract embedding from output
      // The model outputs 384-dimensional embeddings
      const output = results[Object.keys(results)[0]];
      const embeddingData = output.data as Float32Array;
      
      // Return the embedding (first 384 dimensions)
      return new Float32Array(embeddingData.slice(0, 384));
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  /**
   * Searches for similar code chunks
   * @param query - Search query text
   * @param topK - Number of top results to return
   * @returns Array of search results sorted by similarity
   */
  async searchSimilar(query: string, topK: number = 10): Promise<SearchResult[]> {
    this.ensureInitialized();
    
    try {
      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Retrieve all embeddings from database
      const allEmbeddings = this.vectorStore!.getAllEmbeddings();
      
      if (allEmbeddings.length === 0) {
        console.warn('No embeddings found in database');
        return [];
      }
      
      // Calculate similarity scores
      const results = allEmbeddings.map(item => {
        const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
        
        return {
          id: item.id,
          filePath: item.metadata.filePath,
          startLine: item.metadata.startLine,
          endLine: item.metadata.endLine,
          elementType: item.metadata.elementType,
          elementName: item.metadata.elementName,
          similarityScore: similarity,
        };
      });
      
      // Sort by similarity descending
      results.sort((a, b) => b.similarityScore - a.similarityScore);
      
      // Return top K results
      return results.slice(0, topK);
    } catch (error) {
      console.error('Similarity search failed:', error);
      throw error;
    }
  }

  /**
   * Stops the embedding service and cleans up resources
   */
  async stop(): Promise<void> {
    try {
      console.log('Stopping EmbeddingService...');
      
      // Close vector store
      if (this.vectorStore) {
        this.vectorStore.close();
        this.vectorStore = null;
      }
      
      // Release ONNX session
      if (this.session) {
        // ONNX runtime sessions don't have an explicit close in node
        this.session = null;
      }
      
      this.isInitialized = false;
      console.log('EmbeddingService stopped');
    } catch (error) {
      console.error('Error stopping EmbeddingService:', error);
      throw error;
    }
  }

  /**
   * Calculates cosine similarity between two vectors
   * @param a - First vector
   * @param b - Second vector
   * @returns Similarity score between -1 and 1
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dot = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    
    if (denominator === 0) {
      return 0;
    }
    
    return dot / denominator;
  }

  /**
   * Recursively finds all XML files in a directory
   * @param dir - Directory to search
   * @returns Array of absolute file paths
   */
  private async findXMLFiles(dir: string): Promise<string[]> {
    const xmlFiles: string[] = [];
    
    const traverse = async (currentPath: string) => {
      try {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            // Skip node_modules and hidden directories
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await traverse(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.xml')) {
            xmlFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Failed to read directory ${currentPath}:`, error);
      }
    };
    
    await traverse(dir);
    return xmlFiles;
  }

  /**
   * Simple string hash function for tokenization placeholder
   * @param str - String to hash
   * @returns Hash value
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Ensures the service is initialized
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.session || !this.vectorStore) {
      throw new Error('EmbeddingService is not initialized. Call start() first.');
    }
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();