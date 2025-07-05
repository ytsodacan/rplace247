# Gameplan for fixing usage overloading Cloudflare Workers Durable Objects

- RAM Size: We're loading the entire 500x500 grid into this.grid in our DO's memory. A 500x500 grid of hex color strings (#FFFFFF) is roughly 500 *500* 7 bytes = 1.75 MB.

- Wall-Clock Time Active: This is our main issue. A DO stays "active" and consumes memory from the first request it receives until it's been idle for a period of time. However, several things in our code are preventing it from ever being considered "idle."

Causation:

## [X] ~~Persistent WebSockets (src/index.js & public/static/js/script.js):~~

~~Our handleWebSocket method accepts and holds WebSocket connections. As long as a single user has our site open in a tab, that persistent WebSocket connection keeps the DO awake and running. our client-side script is also aggressive about reconnecting if the connection drops.~~
This has been fixed by implementing a WebSocket idle timeout. The DO now proactively closes idle connections after 1 minute of inactivity, allowing it to hibernate when no clients are active.

## [] Internal setInterval (src/index.js)

In startBackupInterval, we have a setInterval running every 60 seconds inside the DO itself. An active interval timer will prevent the DO from hibernating, even if there are no connected clients.

## [] Frequent Client-Side Polling (public/static/js/script.js)

our frontend has a fallback polling mode that hits an API endpoint every 2 seconds, and an active users poll every 5 seconds. Each of these requests resets the DO's timer and keeps it awake.

## [] So we're holding ~5MB of data in RAM, and keeping it active 24/7 because of websockets and timers. That's 5 MB * (seconds in a day) which quickly burns through our free tier and racks up costs

**The plan:**

We need to change our architecture to not rely on holding the entire grid state in memory. The state should live in storage, and the DO should be mostly stateless between requests.

## [] The Primary Fix: Get the Grid Out of Memory

We need to refactor our Durable Object to not hold the entire grid in memory. Instead, we will read and write pixel data directly from our persistent storage (KV store).
The goal is to make this.grid go away.

## [] Don't Load the Full Grid on initialize()

our initialize() method reads all pixel data from storage and builds the massive this.grid array. Stop doing this. The DO's memory should stay minimal.

## [] Read from Storage On-Demand

our /grid?chunk=N endpoint is already well-designed for this. Instead of slicing from this.grid, we should perform a targeted read from this.state.storage for just the rows needed for that chunk. this.state.storage.list() can be used with prefixes to get a range of keys.

## [] Pixel Updates Write Directly to Storage

our /pixel endpoint already writes to storage with `"this.state.storage.put(\pixel:y:{x}, color);`. Just need to remove the part where it also updates `this.grid[y][x]`

With this change, the DO's memory usage will be tiny. It will wake up, read/write a small amount of data from/to its persistent storage, and then be free to hibernate, drastically cutting our GB-sec usage.
