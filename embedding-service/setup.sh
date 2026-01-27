#!/bin/bash

# Setup script for embedding-service
# Installs dependencies and prepares the environment

echo "=== Setting up Embedding Service ==="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✓ npm version: $(npm --version)"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""

# Check if ONNX model exists
MODEL_PATH="./models/model_quantized.onnx"
if [ -f "$MODEL_PATH" ]; then
    echo "✓ ONNX model found at $MODEL_PATH"
else
    echo "⚠️  ONNX model not found at $MODEL_PATH"
    echo "   Please place your model file at: $MODEL_PATH"
    echo "   Expected file: all-minilm-l6-v2-quantized.onnx"
fi

echo ""

# Build TypeScript
echo "Building TypeScript..."
npm run build

if [ $? -eq 0 ]; then
    echo "✓ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To run the example:"
echo "  node dist/example.js"
echo ""
