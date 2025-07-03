# NEUROSAMA PLACE

# Pixel Placement Web App

A collaborative pixel placement app for the Neurosama community

## Changelog

### 7/3/25

grid kept wiping itself when idle - durable objects hibernate then wake up corrupted.

**backup system**

- runs every minute during active use
- moved to kv storage (more reliable than durable objects)
- sha256 hashed, auto cleanup after 24hrs

**corruption detection**

- detects empty grids, hash mismatches, init failures
- auto restore from kv backups
- analytics + discord webhooks for monitoring

**admin console**

- real time server logging via websocket
- draggable 600x400px window with color coded logs
- tracks auth'd sessions, handles reconnects

**ui improvements**

- collapsible left panels (start expanded)
- better modal windows with drag/collapse
- connection status indicators

**files changed:**
src/index.js, public/static/js/script.js, public/index.html, public/static/css/style.css, public/static/js/grid-tender.js

### 7/2/25

- Added robots.txt
- Added sitemap.txt
- Start of implementing user opt-out for analytics and active user tracking
- Added privacy policy
- Added real time active user display
- Added analytics for pixel placements and user sessions with no PII being persisted
- Added auto-cleanup of old anonymized data after 30 days

## Known issues

- Webhook was fubar but may be fixed now??

- Reconnect button is MIA

- Does not support `grab` method of moving admin panel yet (touch use)

- need to add obvious user opt out for analytics and active user tracking

### 7/1/25

- Back to a stable state
- Fixed the "grid doesn't load and nothing works" issue
- Added grid management admin functions & auth
- this repo actually contains front and back end now
- site hosted on cloudflare
logToConsole() -> broadcasts logs via websocket
the logging added for admin console:

- logging points for pixel placements
- whitelist ops
- admin broadcasts (possible broke rn lule)
- grid stuff
- system events

**frontend**

- AdminConsole (which works with adminSessions up there)
fixed horrendous log formatting with timestamps and levels
- autoscroll pog
- also handles websocket reconnects like pixel log does

**frontend but ui related specifically**

- toggled via grid admin at the bottom
- console is a draggable floating window which is fairly smol 600x400px
- color coded log levels (rgb bro)
- connection status indicator

**collapsible panels**

- all left panels start expanded but you can collapse them now
- lil issue making the pixel log bottom end not rounded that i havent fixed yet

**new 'features'**

- modal window update to add dragging & collapsing etc
- originally had admin console in left panel but moved it to a modal because that's better anyways but also because the shit was ugly af printing in such a small window

**files i will be pushin**

- src/index.js - admin console backend + backup system
- public/static/js/script.js - admin console class + collapsible logic
- public/index.html - ui structure updates
- public/static/css/style.css - styling for console + animations
- public/static/js/grid-tender.js - console integration

### 7/2/25

- Added robots.txt
- Added sitemap.txt
- Start of implementing user opt-out for analytics and active user tracking
- Added privacy policy
- Added real time active user display
- Added analytics for pixel placements and user sessions with no PII being persisted
- Added auto-cleanup of old anonymized data after 30 days

## Known issues

- Webhook was fubar but may be fixed now??

- Reconnect button is MIA

- Does not support `grab` method of moving admin panel yet (touch use)

- need to add obvious user opt out for analytics and active user tracking

### 7/1/25

- Back to a stable state
- Fixed the "grid doesn't load and nothing works" issue
- Added grid management admin functions & auth
- this repo actually contains front and back end now
- site hosted on cloudflare
