@echo off
echo ============================================
echo     Ambient Music Radar - Starting...
echo ============================================
echo.

echo [1/3] Starting Backend (FastAPI + Shazam)...
start "Music Radar - Backend" cmd /k "cd /d C:\Users\dm965\Downloads\Music detector\backend && .\venv\Scripts\uvicorn main:app --reload"

echo Waiting for backend to start...
timeout /t 4 /nobreak >nul

echo [2/3] Starting Frontend (React Website)...
start "Music Radar - Frontend" cmd /k "cd /d C:\Users\dm965\Downloads\Music detector\frontend && npm run dev"

echo Waiting for frontend to start...
timeout /t 4 /nobreak >nul

echo [3/3] Opening browser...
start http://localhost:5173

echo.
echo ============================================
echo  App is running at: http://localhost:5173
echo  Close the two CMD windows to stop the app.
echo ============================================
