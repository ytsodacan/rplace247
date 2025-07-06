# NEUROSAMA PLACE

Collaborative pixel placement app for the Neurosama community

## Most recent Changelog

### ~~0.1.7.0~~ | ~~0.1.7.1~~ | 0.1.7.2 – 2025-07-05 round 4

## Security 2

Authenticating the authentication

- check token
- no admin assets without token + discord authentication that can be validated server-side
- redirect for auth failures courtesy of nere

no LEAKED items

### 0.1.6 – 2025-07-05 round 3

## How do I into Security

    Server-side authentication for admin dashboard + UI improvements

- Surely it'll load now
- both not loading and loading too much were a problem so all that's left is just enough

### 0.1.6 – 2025-07-04 round 2

pixel throttle (2 s) + KV update batching

- **Status Page**: atlassian but not really

### 0.1.5 – 2025-07-04

WS timeout hack + conn status icon

See [full changelog](./changelog.md) for the rest.

Website: [neurosama.place](https://neurosama.place)

## Features

- **Collaborative Pixel Placement**: Users can place pixels on a shared grid.
- **Discord OAuth Authentication**: Secure login using Discord oauth2
- **Real-Time Updates**: Live updates via WebSocket for pixel placements & to display active connections
- **Secure Admin Dashboard**: Server-side authentication following Cloudflare Workers security best practices
- ~~**LATENCY**~~: uses a lot of async & generally maintains 200+ FPS with 500x500 grid on a decent machine. Can be lower on extremely high resolution displays, low-end devices, or on first visit.

Ongoing development. Join us on [Discord](https://discord.gg/Ba3H5Tjn) for updates and discussions.
