# NEUROSAMA PLACE

Collaborative pixel placement app for the Neurosama community

## Most recent Changelog

### 0.1.7 – 2025-07-05

**MAJOR SECURITY UPDATE**: Server-side authentication for admin dashboard + UI improvements

### 0.1.6 – 2025-07-05

pixel throttle (2 s) + KV update batching

### 0.1.5 – 2025-07-04

WS timeout hack + conn status icon

See [full changelog](./changelog.md) for the rest.

Website: [neurosama.place](https://neurosama.place)

## Features

- **Collaborative Pixel Placement**: Users can place pixels on a shared grid.
- **Discord OAuth Authentication**: Secure login using Discord oauth2
- **Real-Time Updates**: Live updates via WebSocket for pixel placements & to display active connections
- **Secure Admin Dashboard**: Server-side authentication following Cloudflare Workers security best practices
- ~~**LATENCY**~~: Fully asynchronous & generally maintains 200+ FPS with 500x500 grid on a decent machine. Can be lower on extremely high resolution displays, low-end devices, or on first visit.

## Security

The admin dashboard is protected by server-side authentication middleware that:

- Validates Discord OAuth tokens in real-time
- Checks admin privileges against KV storage
- Prevents unauthorized access entirely (no client-side bypasses)
- Redirects unauthorized users to a filtered page with helpful messaging

This follows Cloudflare Workers security best practices and ensures no admin content is leaked to unauthorized users.

Ongoing development. Join us on [Discord](https://discord.gg/Ba3H5Tjn) for updates and discussions.
