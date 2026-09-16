@echo off
title CIVIS - Sincronizador Automatico a Produccion (GitHub & Railway)
color 0B

echo ==============================================================================
echo        CIVIS: SINCRONIZANDO CAMBIOS A GITHUB Y SERVIDOR EN LA NUBE
echo ==============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Detectando archivos modificados...
git add .

set /p commit_msg="Escribe una descripcion del cambio (o presiona ENTER para auto): "
if "%commit_msg%"=="" set commit_msg=Actualizacion automatica del sistema electoral - %date% %time%

echo [2/3] Guardando version...
git commit -m "%commit_msg%"

echo [3/3] Despachando a GitHub (main y master)...
git push origin main
git push origin master

echo.
echo ==============================================================================
echo   SINCRONIZACION COMPLETADA CON EXITO
echo   Los servidores de Railway procesaran los cambios automaticamente.
echo ==============================================================================
echo.
pause
