# Changelog

## [0.1.3] (i guess) - 2025-07-03

### Added (July 3, 2025)

- **Grid Corruption Detection & Auto-Recovery**: Comprehensive system to detect and automatically recover from grid corruption caused by Durable Object hibernation
- **Automatic Backup System**: Hashed with sha256 just in case the enemy has a quantum computer
- **KV Storage Migration**: Migrated backup storage from Durable Object to KV store for improved reliability
- **Corruption Monitoring**: Analytics tracking and Discord webhook notifications for grid corruption events
- **Auto-Cleanup**: Old backups automatically removed after 24 hours to manage storage
- **Admin Console**: Pseudo-console in UI for admin users (monitoring server)
- **Collapsible Panels**: Live View, Active Users, and Pixel Log panels now collapsible (start expanded, user can collapse)
- **Panel State Persistence**: User panel preferences saved to localStorage and restored on page load
- **Connection Status Indicators**: Visual indicators for WebSocket connection status

### Added (July 2, 2025)

- **SEO Files**: Added robots.txt and sitemap.txt
- **Privacy Policy**: Added privacy policy documentation
- **Real-Time Active Users**: Live display of current active users
- **Analytics**: Pixel placements and user sessions tracking with no PII persistence
- **Data Retention**: Auto-cleanup of anonymized analytics data after 30 days
- **User Opt-Out**: Started implementing user opt-out for analytics and active user tracking

### Added (July 1, 2025)

- **Grid Management**: Admin functions with authentication
- **Cloudflare Hosting**: Site hosted on Cloudflare infrastructure
- **Admin Session Management**: Backend support for authentication
- **Comprehensive Logging**: Logging for many events

### Fixed (July 3, 2025)

Fixes:

- **Grid Data Loss**: Resolved issue where grid would clear to empty state after idle periods due to Durable Object hibernation
- **Grid Loading Issues**: Fixed "grid doesn't load and nothing works" issue
- **Code Quality**: Resolved biome linting warnings

### Improved (July 3, 2025)

Further work on added features:

- **User Interface**: Cleaner interface with collapsible panels and smooth hover effects
- **Modal Windows**: Updated modal system to support dragging and collapsing
- **Panel Layout**: All left panels start expanded but can be collapsed by user
- **Animation System**: Smooth animations pog

## Known Issues

- Webhook functionality may be unstable
- Reconnect button is missing from UI
- Admin panel does not support touch-based grab method for moving
- User opt-out for analytics and active user tracking needs more obvious UI implementation
- Pixel log panel bottom corner rounding issue when collapsed
