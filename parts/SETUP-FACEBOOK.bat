@echo off
title Facebook Setup - Booster Ustad
cd /d "%~dp0"
echo.
echo  ================================================
echo   Facebook Real Connection Setup
echo  ================================================
echo.
echo  Apna FB_APP_ID paste karein (right-click se paste hota hai)
echo  phir Enter dabayein:
set /p APPID=^> 
echo.
echo  Apna FB_APP_SECRET paste karein phir Enter dabayein:
set /p SECRET=^> 
echo.
echo  Configuration ID hai to paste karein
echo  (Facebook Login for Business - Configurations wala)
echo  na ho to khaali Enter dabayein:
set /p CONFIGID=^> 
(
echo FB_APP_ID=%APPID%
echo FB_APP_SECRET=%SECRET%
echo FB_REDIRECT_URI=http://localhost:3000/api/facebook/callback
echo FB_CONFIG_ID=%CONFIGID%
) > .env
echo.
echo  ================================================
echo   Ho gaya! .env file ban gayi hai.
echo.
echo   Ab ye karein:
echo   1. Kali window (server) band karein
echo   2. START-Booster-Ustad.bat dobara chalyein
echo   3. [config] mein fb=REAL(meta) nazar aana chahiye!
echo  ================================================
echo.
pause
