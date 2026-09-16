@echo off
title CIVIS - Sistema Electoral en Tiempo Real
color 0A

echo ==============================================================================
echo           INICIANDO CIVIS - SISTEMA ELECTORAL & DETECCION DE CRUCES
echo ==============================================================================
echo.

cd /d "%~dp0backend"

echo [1/3] Verificando instalacion de dependencias...
python -m pip install -r requirements.txt --quiet

echo.
echo [2/3] Iniciando servidor FastAPI, WebSockets y Base de Datos (PostgreSQL/SQLite)...
echo Servidor activo en: http://localhost:8000
echo.

start http://localhost:8000

python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause
