import { XMLChunker } from './embedding-service/chunker';
import { Embedder } from './embedding-service/embedder';
import { config, getProjectPaths } from './config';
import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';

/**
 * Export all embeddings and metadata to JSON
 * 
 * This script processes all XML files in configured projects,
 * generates chunks and embeddings, and exports everything to a JSON file.
 * 
 * Usage:
 *   npx ts-node src/export-embeddings.ts [output-file.json]
 */

interface ExportedChunk {
    filePath: string;
    chunkType: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    content: string;
    embeddingText: string;
    contentHash: string;
    context: any;
    isSequenceDefinition: boolean;
    referencedSequences: string[];
}

async function main() {
    const args = process.argv.slice(2);
    const outputFile = args[0] || path.resolve(process.cwd(), 'embeddings-export.json');

    console.log(`\n📦 Embedding Service Export Utility\n`);
    console.log(`Output file: ${outputFile}\n`);

    // Initialize embedder
    console.log('🔧 Initializing embedder...');
    const embedder = new Embedder();
    await embedder.initialize(config.modelPath);
    console.log('✅ Embedder initialized\n');

    // Create chunker
    const chunker = new XMLChunker(embedder);

    // Get all project paths
    const projectPaths = getProjectPaths(config);
    console.log(`📂 Scanning projects:`);
    projectPaths.forEach(p => console.log(`   - ${p}`));
    console.log();

    // Find all XML files
    const allXmlFiles: string[] = [];
    for (const projectPath of projectPaths) {
        if (!fs.existsSync(projectPath)) {
            console.log(`⚠️  Skipping non-existent path: ${projectPath}`);
            continue;
        }

        const pattern = path.join(projectPath, '**/*.xml');
        const files = await glob(pattern, { nodir: true });
        allXmlFiles.push(...files);
    }

    console.log(`📄 Found ${allXmlFiles.length} XML files\n`);

    if (allXmlFiles.length === 0) {
        console.log('⚠️  No XML files found. Exiting.');
        await embedder.close();
        return;
    }

    // Process all files and collect chunks with embeddings
    const exportData: ExportedChunk[] = [];
    let processedFiles = 0;
    let totalChunks = 0;

    for (const filePath of allXmlFiles) {
        try {
            processedFiles++;
            console.log(`[${processedFiles}/${allXmlFiles.length}] Processing: ${path.relative(config.workspaceRoot, filePath)}`);

            // Generate chunks
            const chunks = await chunker.chunkFile(filePath);
            console.log(`   ✓ Extracted ${chunks.length} chunks`);

            // Prepare export data (metadata only, no embeddings)
            for (const chunk of chunks) {
                const exportChunk: ExportedChunk = {
                    filePath: chunk.filePath,
                    chunkType: chunk.chunkType,
                    chunkIndex: chunk.chunkIndex,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    content: chunk.content,
                    embeddingText: chunk.embeddingText,
                    contentHash: chunk.contentHash,
                    context: chunk.context,
                    isSequenceDefinition: chunk.isSequenceDefinition ?? false,
                    referencedSequences: chunk.referencedSequences ?? [],
                };

                exportData.push(exportChunk);
                totalChunks++;
            }

        } catch (error) {
            console.error(`   ✗ Error processing ${filePath}:`, error);
        }
    }

    console.log(`\n📊 Export Summary:`);
    console.log(`   Files processed: ${processedFiles}`);
    console.log(`   Total chunks: ${totalChunks}`);

    // Write to JSON file
    console.log(`\n💾 Writing to ${outputFile}...`);
    const jsonContent = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(outputFile, jsonContent, 'utf-8');

    const fileSizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
    console.log(`✅ Export complete! File size: ${fileSizeMB} MB\n`);

    await embedder.close();
    console.log('✅ Done\n');
}

main().catch(console.error);
