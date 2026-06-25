#!/bin/bash

# Start script for local development
# This script starts both the backend and frontend services

echo "Starting Gulf Coast Operations..."
echo ""

# Check if Python dependencies are installed
echo "Checking Python dependencies..."
if ! pip show fastapi > /dev/null 2>&1; then
    echo "Installing Python dependencies..."
    pip install -r requirements.txt
fi

# Check if Node dependencies are installed
echo "Checking Node dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing Node dependencies..."
    npm install
fi

echo ""
echo "Dependencies ready"
echo ""
echo "Starting services..."
echo "  - Backend API: http://localhost:8001"
echo "  - Frontend Dev: http://localhost:5173"
echo ""

# Start backend in background
echo "Starting backend..."
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001 &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend
echo "Starting frontend..."
npm run dev

# Clean up on exit
trap "kill $BACKEND_PID" EXIT
