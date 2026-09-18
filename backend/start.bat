@echo off
echo ========================================
echo  REACT-X Backend — Starting up
echo ========================================

cd /d "%~dp0"

IF NOT EXIST venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt --quiet

echo.
echo Starting FastAPI server on http://localhost:8000
echo Press Ctrl+C to stop.
echo.

uvicorn app.main:app --reload --port 8000 --host 0.0.0.0

pause
