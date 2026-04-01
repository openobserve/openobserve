#!/bin/bash

# Kill any existing processes on these ports to prevent conflicts
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:8081 | xargs kill -9 2>/dev/null

echo "Starting Backend Server (FastAPI + GGUF Model)..."
cd "$(dirname "$0")/chat-server"
uv run uvicorn server:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!

echo "Starting Frontend (React Native Expo)..."
cd "../chat-app"
npx expo start --clear &
EXPO_PID=$!

echo "--------------------------------------------------------"
echo "Services are starting!"
echo "- Backend is running on port 8000"
echo "- Frontend QR code will appear above to scan in Expo Go"
echo "Press Ctrl+C to stop both services."
echo "--------------------------------------------------------"

# Wait for both processes to finish (or until Ctrl+C is pressed)
wait $SERVER_PID $EXPO_PID
