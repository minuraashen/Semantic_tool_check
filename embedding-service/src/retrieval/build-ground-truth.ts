#!/usr/bin/env node

/**
 * build-ground-truth.ts
 *
 * Reads results.csv (manually curated query → file + line-range ground truth)
 * and resolves each entry to actual chunk IDs from embeddings.db.
 *
 * Output: ground-truth.json
 *
 * Usage:
 *   npm run ground-truth:build
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

// ── Paths ──────────────────────────────────────────────────────
const rootDir = path.resolve(__dirname, '../../');
const csvPath = path.resolve(rootDir, '../final-ground-truth.csv');
const dbPath = path.resolve(rootDir, 'data/embeddings.db');
const outputPath = path.resolve(rootDir, '../final-ground-truth.json');

// ── Types ──────────────────────────────────────────────────────

interface GroundTruthFile {
    fileName: string;
    lineRange: string; // original CSV value, e.g. "14-60" or "All lines"
    chunkIds: number[];
}

interface GroundTruthQuery {
    id: string;
    text: string;
    category: string;
    subtype: string;
    files: GroundTruthFile[];
    totalRelevantChunks: number;
    allRelevantChunkIds: number[];
}

interface GroundTruthDataset {
    generatedAt: string;
    databasePath: string;
    csvPath: string;
    totalQueries: number;
    totalChunksInDb: number;
    queries: GroundTruthQuery[];
}

// ── CSV Parsing ────────────────────────────────────────────────

/**
 * Parse the multi-row CSV format where a single query can span multiple rows
 * (one per relevant file). The Query column is populated on every row.
 */
function parseCSV(csvContent: string): {
    text: string;
    category: string;
    subtype: string;
    files: { fileName: string; lineRange: string; }[];
}[] {
    const lines = csvContent.split('\n').map(l => l.replace(/\r$/, ''));

    // Skip the 1 header row (it was 2 before, but looking at file content it seems just 1: "query,xml_file,line_number_range,query_category,query_subtype")
    const dataLines = lines.slice(1).filter(l => l.trim().length > 0);

    const queries: {
        text: string;
        category: string;
        subtype: string;
        files: { fileName: string; lineRange: string; }[];
    }[] = [];

    let currentQuery: typeof queries[0] | null = null;

    for (const line of dataLines) {
        // Parse CSV respecting quoted fields
        const fields = parseCSVLine(line);

        const queryText = fields[0]?.replace(/^"+|"+$/g, '').trim();
        const category = fields[1]?.trim() || 'unknown';
        const subtype = fields[2]?.trim() || 'unknown';
        const fileName = fields[3]?.trim();
        const lineRange = fields[4]?.trim();

        if (queryText) {
            // Check if this is a continuation of the current query or a new one
            if (!currentQuery || currentQuery.text !== queryText) {
                currentQuery = {
                    text: queryText,
                    category,
                    subtype,
                    files: [],
                };
                queries.push(currentQuery);
            }
        }

        if (currentQuery && fileName) {
            currentQuery.files.push({
                fileName,
                lineRange: lineRange || 'All lines',
            });
        }
    }

    return queries;
}

/**
 * Simple CSV line parser that handles quoted fields with commas.
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            // Toggle quotes (handles "" escape as well)
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

// ── Chunk ID Resolution ────────────────────────────────────────

function resolveChunkIds(
    db: Database.Database,
    fileName: string,
    lineRange: string
): number[] {
    // Build the LIKE pattern — match by file basename since file_path is absolute
    const likePattern = `%${fileName}`;

    if (lineRange === 'All lines') {
        // All chunks in this file
        const stmt = db.prepare(
            `SELECT id FROM chunks WHERE file_path LIKE ? ORDER BY start_line`
        );
        const rows = stmt.all(likePattern) as { id: number }[];
        return rows.map(r => r.id);
    }

    // Parse line range: could be "14-60" (range) or "33" (single line)
    const parts = lineRange.split('-').map(s => parseInt(s.trim(), 10));
    const startLine = parts[0];
    const endLine = parts.length > 1 ? parts[1] : parts[0];

    if (isNaN(startLine)) {
        console.warn(`  ⚠️  Could not parse line range "${lineRange}" for ${fileName}`);
        return [];
    }

    // Find chunks that OVERLAP with the specified line range.
    // A chunk overlaps if: chunk.start_line <= endLine AND chunk.end_line >= startLine
    const stmt = db.prepare(`
    SELECT id, start_line, end_line
    FROM chunks
    WHERE file_path LIKE ?
      AND start_line <= ?
      AND end_line >= ?
    ORDER BY start_line
  `);
    const rows = stmt.all(likePattern, endLine, startLine) as {
        id: number;
        start_line: number;
        end_line: number;
    }[];

    return rows.map(r => r.id);
}

// ── Main ───────────────────────────────────────────────────────

function main() {
    console.log('🔧 Building Ground Truth Dataset');
    console.log('─'.repeat(50));

    // 1. Read CSV
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV not found: ${csvPath}`);
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const parsedQueries = parseCSV(csvContent);
    console.log(`📄 Parsed ${parsedQueries.length} queries from CSV`);

    // 2. Open database
    if (!fs.existsSync(dbPath)) {
        console.error(`❌ Database not found: ${dbPath}`);
        process.exit(1);
    }
    const db = new Database(dbPath, { readonly: true });

    // Total chunks in DB
    const totalChunks = (
        db.prepare(`SELECT COUNT(*) AS cnt FROM chunks`).get() as { cnt: number }
    ).cnt;
    console.log(`💾 Database has ${totalChunks} total chunks\n`);

    // 3. Resolve each query
    const groundTruthQueries: GroundTruthQuery[] = [];
    let warnings = 0;

    for (let i = 0; i < parsedQueries.length; i++) {
        const q = parsedQueries[i];
        const queryId = `Q${String(i + 1).padStart(3, '0')}`;

        console.log(`  ${queryId}: "${q.text}"`);

        const files: GroundTruthFile[] = [];
        const allChunkIds: number[] = [];

        for (const f of q.files) {
            const chunkIds = resolveChunkIds(db, f.fileName, f.lineRange);

            if (chunkIds.length === 0) {
                console.warn(`    ⚠️  No chunks found for ${f.fileName} [${f.lineRange}]`);
                warnings++;
            } else {
                console.log(
                    `    ✅ ${f.fileName} [${f.lineRange}] → ${chunkIds.length} chunk(s): [${chunkIds.join(', ')}]`
                );
            }

            files.push({
                fileName: f.fileName,
                lineRange: f.lineRange,
                chunkIds,
            });
            allChunkIds.push(...chunkIds);
        }

        // Deduplicate chunk IDs (in case overlapping ranges)
        const uniqueChunkIds = [...new Set(allChunkIds)];

        groundTruthQueries.push({
            id: queryId,
            text: q.text,
            category: q.category,
            subtype: q.subtype,
            files,
            totalRelevantChunks: uniqueChunkIds.length,
            allRelevantChunkIds: uniqueChunkIds,
        });

        console.log(`    📊 Total relevant chunks: ${uniqueChunkIds.length}\n`);
    }

    db.close();

    // 4. Build output
    const dataset: GroundTruthDataset = {
        generatedAt: new Date().toISOString(),
        databasePath: dbPath,
        csvPath,
        totalQueries: groundTruthQueries.length,
        totalChunksInDb: totalChunks,
        queries: groundTruthQueries,
    };

    // 5. Write JSON
    fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2), 'utf-8');

    console.log('─'.repeat(50));
    console.log(`✅ Ground truth written to: ${outputPath}`);
    console.log(`   Queries: ${dataset.totalQueries}`);
    console.log(`   Warnings: ${warnings}`);

    // Summary statistics
    const chunkCounts = groundTruthQueries.map(q => q.totalRelevantChunks);
    console.log(`\n📈 Relevant chunks per query:`);
    console.log(`   Min: ${Math.min(...chunkCounts)}`);
    console.log(`   Max: ${Math.max(...chunkCounts)}`);
    console.log(
        `   Avg: ${(chunkCounts.reduce((a, b) => a + b, 0) / chunkCounts.length).toFixed(1)}`
    );
}

main();
