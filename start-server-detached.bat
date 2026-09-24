@echo off
start "" /b "C:\Program Files\nodejs\node.exe" --import tsx src/index.ts > server.out.log 2> server.err.log