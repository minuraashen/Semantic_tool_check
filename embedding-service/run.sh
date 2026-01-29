#!/bin/bash
cd "$(dirname "$0")"
rm -f data/embeddings.db
npm run build
echo "Starting service..."
npm run dev
