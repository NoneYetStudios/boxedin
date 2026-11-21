# Boxed In — STF Arcade

Capture cubes, control territory, and outsmart your opponent in this 3D strategy puzzle inspired by Dots & Boxes.

Built with HTML, CSS, JavaScript, and Three.js. No build step, no backend, no accounts, and no server-side storage required.

Built with **Google Antigravity** · Play it live: [boxedin.stabthefinger.com](https://boxedin.stabthefinger.com) · Part of the [STF Arcade](https://stabthefinger.com/stfarcade.html)

## Screenshot

![Boxed In Screenshot](screenshot.png)

## How to Play

The goal is simple: capture more cubes than your opponent.

1. Claim edges on the 3D lattice.
2. Complete all **12 edges** surrounding a cube.
3. Captured cubes become highlighted in your color and score points.
4. Completing a cube grants an extra turn.
5. Chain captures together to dominate the board.
6. The player with the most captured cubes wins.

## Highlights

- 3D cube-capture strategy gameplay inspired by Dots & Boxes
- Fully interactive 3D board using Three.js
- Player vs Computer and local hotseat Player vs Player modes
- Easy, Medium, and Hard AI opponents
- Multiple board sizes
- Desktop and mobile support
- Orbit, zoom, and pan camera controls
- Live move analysis and strategy hints
- Local career statistics
- No backend or accounts required
- Pure client-side web application

## Features

### Game Modes

- **Player vs Computer**
  - Easy AI
  - Medium AI
  - Hard AI

- **Player vs Player**
  - Local hotseat play

### Board Sizes

| Size | Cubes | Typical Match Length |
|--------|--------|--------|
| Quick (2×2×2) | 8 | ~5 minutes |
| Standard (3×3×3) | 27 | ~10 minutes |
| Large (4×4×4) | 64 | 20+ minutes |

The Standard (3×3×3) board is the default experience.

### Camera Controls

#### Desktop

- Left-drag: Rotate
- Mouse wheel: Zoom
- Right-drag: Pan

#### Mobile

- One-finger drag: Rotate
- Pinch: Zoom
- Two-finger drag: Pan

### Smart Move Assistance

Every edge preview provides strategic information before you play:

- Cubes affected
- Cubes completed
- Vulnerable cubes created

Examples:

- Safe edge
- Completes 1 cube
- Creates 2 vulnerable cubes

This makes the game approachable while still allowing deeper strategy.

### Edge Placement Options

Desktop defaults to:

- Hover preview
- Single-click placement

Touch devices default to:

- Tap to preview
- Tap again to confirm

Players can toggle placement behavior at any time.

### Statistics

Career statistics are stored locally using LocalStorage.

Tracked statistics include:

- Games Played
- Games Won
- Win Percentage
- Best Win Percentage by Color
- Fastest Victory
- Largest Margin of Victory

### Additional Polish

- Floating rotating cube preview on setup screen
- Animated cube captures
- Particle effects
- Procedural Web Audio sound effects
- Reset View button
- Undo Last Move support
- Illustrated How To Play guide
- Keyboard shortcuts

## Architecture

### Root

- `index.html`
  - Single-page application shell
  - Setup screen
  - HUD
  - Modals
  - Import map

### CSS

- `css/style.css`
  - Responsive desktop/mobile layout
  - STF Arcade theme
  - HUD styling
  - Modal styling

### Assets

- `assets/favicon.svg`
  - Isometric glowing cube icon

### JavaScript

#### Core Configuration

- `js/config.js`
  - Color palettes
  - Board presets
  - AI metadata
  - Storage keys

#### Board Topology

- `js/lattice.js`
  - Pure 3D lattice generation
  - Edge relationships
  - Cube adjacency

#### Rules Engine

- `js/game.js`
  - Game state management
  - Capture logic
  - Turn handling
  - Undo support
  - Serialization

#### Artificial Intelligence

- `js/ai.js`
  - Easy AI
  - Medium AI
  - Hard AI
  - Chain analysis
  - Board-control heuristics

#### Persistence

- `js/storage.js`
  - LocalStorage settings
  - Career statistics

#### Audio

- `js/audio.js`
  - Procedural Web Audio effects
  - Mute support

#### Rendering

- `js/renderer.js`
  - Three.js scene
  - OrbitControls
  - Raycasting
  - Animations
  - Particle effects

#### User Interface

- `js/ui.js`
  - DOM bindings
  - HUD updates
  - Modal management
  - Gameplay help

#### Application Startup

- `js/main.js`
  - Initialization
  - Event wiring
  - AI orchestration

## Keyboard Shortcuts

| Key | Action |
|-------|-------|
| R | Reset View |
| Z | Undo Last Move |
| M | Toggle Mute |
| Esc | Cancel Current Selection |

## Deploying

Boxed In is a pure static web application.

No database, backend, PHP, Node.js server, or build pipeline is required.

Upload the following items:

```text
index.html
.htaccess
assets/
css/
js/
```

Optional development files that do not need to be deployed:

```text
README.md
tests/
.gitignore
```

Because the game uses ES modules and imports Three.js from jsDelivr, it must be served over HTTP or HTTPS.

Do not open directly via file:// URLs.

## Local Development

### Syntax Validation

```powershell
Get-ChildItem js\*.js, tests\*.mjs |
    ForEach-Object { node --check $_.FullName }
```

### Automated Verification

```powershell
node tests/verify.mjs
```

### Serve Locally

```powershell
python -m http.server 8765
```

Then open:

```text
http://localhost:8765
```

## Future Ideas

- Additional AI personalities
- Team game modes
- Spectator mode
- AI vs AI battlesnate visual themes
- Tournament mode
- Additional board configurations

---

Part of the **Stab The Finger Arcade** collection.

If you've ever wondered what happens when Dots & Boxes grows a third dimension, welcome to Boxed In.

---

## License

MIT License © 2026 Anthony Moore / None Yet Studios

Take it apart. Learn from it. Improve it. Build something weird with it.

See the `LICENSE` file for the full license text.
