@echo off
:: ============================================================
::  start.bat  —  Run the interpreter in the background
::  Usage:  start.bat [start|stop|log|list]
:: ============================================================

SET DIR=%~dp0
SET LOG=%DIR%interpreter.log

IF "%1"==""      GOTO start_fg
IF "%1"=="start" GOTO start_bg
IF "%1"=="stop"  GOTO stop
IF "%1"=="log"   GOTO showlog
IF "%1"=="list"  GOTO list
GOTO usage

:start_fg
echo Starting interpreter (foreground — Ctrl+C to stop) ...
node "%DIR%interpreter.js"
GOTO end

:start_bg
echo Starting interpreter in background ...
START "GermanDutchInterpreter" /B node "%DIR%interpreter.js" >> "%LOG%" 2>&1
echo Started. Log: %LOG%
echo To watch log: start.bat log
GOTO end

:stop
TASKKILL /FI "WINDOWTITLE eq GermanDutchInterpreter" /F 2>nul
echo Stopped.
GOTO end

:showlog
powershell -command "Get-Content '%LOG%' -Wait"
GOTO end

:list
node "%DIR%interpreter.js" --list
GOTO end

:usage
echo Usage: start.bat [start ^| stop ^| log ^| list]
echo   (no args)  = run in foreground
echo   start      = run silently in background
echo   stop       = kill background process
echo   log        = tail the log file
echo   list       = list audio input devices

:end
