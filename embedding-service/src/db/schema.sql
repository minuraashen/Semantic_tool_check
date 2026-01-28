-- Code chunks with embeddings
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  parent_chunk_id INTEGER,
  embedding BLOB NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (parent_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_file_hash ON chunks(file_hash);
CREATE INDEX IF NOT EXISTS idx_resource_type ON chunks(resource_type);
CREATE INDEX IF NOT EXISTS idx_parent_chunk ON chunks(parent_chunk_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_chunk ON chunks(file_path, chunk_index, start_line, end_line);
