# Changelog

## 0.1.6 – 2025-07-05

- pixel throttle (non-admin: 1 px / 2 s)
- KV write batching (2 s debounce) to stop random 429s if many updates are being made to kv at once

## 0.1.5 – 2025-07-04

- quick WS timeout so DO can hibernate properly.
- moved conn status icon out of chat

## 0.1.4 – 2025-07-04

- status page + backend pinger + auto-redirect
- anon pixel bug squashed
- service indicators (grid/ws/api)

## 0.1.3 – 2025-07-03

- grid corruption auto-recovery + backups in KV
- admin console & live logs
- collapsible panels + state save
- active users list + basic analytics
- SEO bits, privacy policy, etc.
