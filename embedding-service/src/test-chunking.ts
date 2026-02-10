import { XMLChunker } from './embedding-service/chunker';
import { Embedder } from './embedding-service/embedder';
import { config } from './config';
import * as path from 'path';

/**
 * Test script to inspect actual embedding text generated from chunks
 * 
 * Usage:
 *   npx ts-node src/test-chunking.ts <path-to-xml-file>
 */

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: npx ts-node src/test-chunking.ts <path-to-xml-file>');
        console.error('\nExample:');
        console.error('  npx ts-node src/test-chunking.ts ../BankIntegration/src/main/wso2mi/artifacts/apis/BookingAPI.xml');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    console.log(`\n📄 Analyzing: ${filePath}\n`);

    // Initialize embedder for accurate token counting
    const embedder = new Embedder();
    await embedder.initialize(config.modelPath);
    console.log('✅ Embedder initialized\n');

    // Create chunker
    const chunker = new XMLChunker(embedder);

    // Process file
    const chunks = await chunker.chunkFile(filePath);

    console.log(`📊 Total Chunks: ${chunks.length}\n`);
    console.log('='.repeat(80));

    // Show first 3 chunks as examples
    const examplesToShow = Math.min(3, chunks.length);

    for (let i = 0; i < examplesToShow; i++) {
        const chunk = chunks[i];

        console.log(`\n🔹 Chunk #${chunk.chunkIndex} (${chunk.chunkType})`);
        console.log(`   Lines: ${chunk.startLine}-${chunk.endLine}`);
        console.log(`   Resource: ${chunk.resourceName}`);
        console.log(`   Semantic Type: ${chunk.semanticType}`);
        console.log(`   Semantic Intent: ${chunk.semanticIntent}`);
        console.log(`   Context: ${JSON.stringify(chunk.context)}`);

        // Show raw XML content (first 150 chars)
        console.log(`\n   📝 Raw XML Content (preview):`);
        const contentPreview = chunk.content.substring(0, 150).replace(/\n/g, ' ');
        console.log(`   ${contentPreview}...`);

        // Show the actual embedding text
        console.log(`\n   ✨ Embedding Text (what gets embedded):`);
        console.log(`   ${chunk.embeddingText}`);

        // Token count
        const tokenCount = embedder.countTokens(chunk.embeddingText);
        console.log(`\n   🔢 Token Count: ${tokenCount} (limit: ${config.maxTokens})`);

        // References
        if (chunk.referencedSequences && chunk.referencedSequences.length > 0) {
            console.log(`\n   🔗 References: ${chunk.referencedSequences.join(', ')}`);
        }

        console.log('\n' + '='.repeat(80));
    }

    if (chunks.length > examplesToShow) {
        console.log(`\n... and ${chunks.length - examplesToShow} more chunks\n`);
    }

    // Summary statistics
    console.log('\n📈 Statistics:');
    const chunkTypes = chunks.reduce((acc, c) => {
        acc[c.chunkType] = (acc[c.chunkType] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    console.log('   Chunk Types:');
    Object.entries(chunkTypes)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`     - ${type}: ${count}`);
        });

    const avgTokens = chunks.reduce((sum, c) =>
        sum + embedder.countTokens(c.embeddingText), 0) / chunks.length;
    console.log(`\n   Average Token Count: ${avgTokens.toFixed(1)}`);

    await embedder.close();
    console.log('\n✅ Done\n');
}

main().catch(console.error);
