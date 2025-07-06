# Changelog

## 0.1.7.3 – 2025-07-06

- grid refresh now broadcasts to all connected users -working on removing requirement for manual refresh when this is done
- user profile picture properly reverts to default on logout
- settings cleared on logout for security

## 0.1.7.2 – 2025-07-06

- admin dashboard loading fix (for real this time)
- better script error handling + debugging
- dashboard actually loads after auth now

## 0.1.7.1 – 2025-07-06

- fixed infinite loading spinner on admin dashboard
- backend timeout increased from 2s to 10s
- replaced auto-redirects with manual reconnect modal
- try reconnect + status page buttons

## 0.1.7 – 2025-07-05

- auth protection for admin assets (js/css files)
- server-side auth using discord oauth for admin check
- fixed admin dashboard scrolling
- filtered page countdown + links after 10s
- mobile responsive improvements

## 0.1.6 – 2025-07-05

- pixel throttle (non-admin: 1 px / 2 s)
- KV write batching (2 s debounce) to stop random 429s if many updates are being made to kv at once
- admin dashboard auth protection (prevents panel from briefly showing before auth check)

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
- moved conn status icon out of chat

## 0.1.4 – 2025-07-03

- status page + backend pinger + auto-redirect
- anon pixel bug squashed
- service indicators (grid/ws/api)

## 0.1.3 – 2025-07-02

- grid corruption auto-recovery + backups in KV
- admin console & live logs
- collapsible panels + state save
- active users list + basic analytics
- SEO bits, privacy policy, etc.
