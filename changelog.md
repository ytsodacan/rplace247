# Changelog

## 0.1.7 – 2025-07-05

- **MAJOR SECURITY UPDATE**: Server-side authentication for admin dashboard
  - Admin dashboard (`/dash.html`) now requires valid authentication server-side
  - Unauthorized users are redirected to filtered page instead of seeing admin UI
  - No more client-side auth bypass possibilities
  - Follows Cloudflare Workers security best practices
- **UI Improvements**:
  - Fixed scrolling issues in admin dashboard
  - Enhanced filtered page with pen testing message and 10s countdown
  - Added links to homepage and status page after countdown
  - Improved responsive design for mobile devices
- **Code Cleanup**:
  - Removed client-side authentication checks (now server-side only)
  - Simplified dashboard loading process
  - Better error handling and user feedback

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
