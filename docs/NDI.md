# NDI output (render window → media server / other machines)

The engine stays a fullscreen browser window; NDI capture happens **outside**
it with standard tools. Two paths, pick one.

## Path A — NDI Tools Screen Capture (zero config)

```
winget install NDI.NDITools
```

1. Launch **NDI Screen Capture** (in the NDI Tools launcher).
2. Right-click its tray icon → **Capture Settings** → pick the Chrome window
   running the render page (or the whole display the projector output mirrors).
3. Done — the machine is now broadcasting an NDI source named
   `<COMPUTERNAME> (Screen Capture)`.

Fastest to set up; source name is fixed to the machine name.

## Path B — OBS + DistroAV (named output, more control)

```
winget install OBSProject.OBSStudio
```

DistroAV (formerly obs-ndi) is not on winget — download the installer from
the GitHub releases page: https://github.com/DistroAV/DistroAV/releases
(it also needs the NDI runtime, which the NDI Tools install above provides).

1. In OBS: add a **Window Capture** source → pick the Chrome render window.
2. Set the canvas to 1920×1080 @ 60fps (Settings → Video).
3. Tools → **DistroAV NDI Settings** → enable **Main Output**, set the output
   name to `FRIENDS INFATUATED`.
4. OBS is now the NDI sender; it must stay running all night (minimized is
   fine, but don't let it get closed).

## Show-night checklist

- [ ] Render window fullscreen (**F11**, or the engine's `f` key) on the
      1920×1080 output.
- [ ] Chrome **hardware acceleration ON** (Settings → System). Never disable
      it — the WebGL2 post pass falls back to the raw 2D canvas without it.
- [ ] Windows **Do Not Disturb / Focus assist ON** — no toast notifications
      over the visuals.
- [ ] Display sleep / screensaver OFF (Settings → System → Power).
- [ ] Path B only: NDI output named `FRIENDS INFATUATED`, OBS canvas
      1920×1080 @ 60.
- [ ] Verify the feed on the receiving machine with **NDI Studio Monitor**
      (ships with NDI Tools) before doors.

## How a receiver finds the source

NDI is auto-discovering via mDNS on the local network: any receiver
(Resolume Arena → NDI sources, OBS on another machine via a DistroAV NDI
Source, NDI Studio Monitor, TouchDesigner `ndiin` TOP…) on the **same LAN**
lists the source by name — `<MACHINE> (Screen Capture)` for Path A,
`<MACHINE> (FRIENDS INFATUATED)` for Path B. No IP configuration needed; if
the source doesn't appear, check that both machines are on the same subnet
and that Windows Firewall allows the NDI/OBS apps on private networks.
