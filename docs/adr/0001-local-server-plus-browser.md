# ADR-0001: Local dependency-free server + browser frontend + thin CLI

- **Status:** accepted
- **Date:** 2026-08-28

## Context

Eddie needs to open files instantly from terminal and Finder on a Mac, edit
and save them, and be fully drivable by agents. Options considered: a native
app (Swift/Electron), a pure-browser app with the File System Access API, or
a local server + browser tab.

## Decision

A three-part shape: a thin CLI that health-checks/starts the server and opens
a browser tab; a local HTTP server owning all side effects (files, git, AI);
a browser frontend that is purely a client of that server. The server uses
only `node:` built-ins — zero npm dependencies.

## Consequences

- Fast startup, no app packaging, trivially hackable; the browser gives us a
  first-class rendering engine for preview.
- The server is the natural agent surface (ADR-0003) — native apps aren't.
- Electron-style OS integration (real menus, dock badge) is off the table;
  Finder integration goes through a small AppleScript shim instead.
- Dependency-free server means we implement small things (static serving,
  routing) ourselves and accept that.
