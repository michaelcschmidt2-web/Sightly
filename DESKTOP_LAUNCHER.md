# Sightly Vision Desktop Launcher

This keeps the existing Sightly Vite/React app unchanged and adds a quick desktop-style launcher.

## Files

- `run-sightly-desktop.sh` — starts the Sightly dev server on `http://127.0.0.1:5173` and opens it in an app-style browser window when Chrome/Chromium/Edge is available.
- `sightly-vision.desktop` — Linux/WSLg desktop entry that points at the launcher script.

## Run from terminal

```bash
cd ~/agent-workspace/sightly
./run-sightly-desktop.sh
```

## Add to a Linux desktop / WSLg app menu

```bash
cd ~/agent-workspace/sightly
chmod +x run-sightly-desktop.sh sightly-vision.desktop
cp sightly-vision.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

Then look for **Sightly Vision** in your Linux/WSLg app launcher.

## Windows launcher

A Windows batch launcher is included:

```text
Launch Sightly Vision.bat
```

You can copy that `.bat` file to your Windows Desktop, then double-click it. It runs the WSL launcher and starts Sightly.

## Windows/browser fallback

If the app-style browser window cannot open from WSL, the launcher still starts Sightly and prints:

```text
http://127.0.0.1:5173
```

Open that URL in Windows Chrome/Edge. You can also use Chrome/Edge's browser menu to install/create a shortcut for the app window.

## Stop the dev server

```bash
cd ~/agent-workspace/sightly
kill "$(cat .launcher/sightly-desktop.pid)"
```
