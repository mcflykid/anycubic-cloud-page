# Anycubic Cloud Page

**Follow and control your Anycubic printer from a browser.** This self-hosted workshop connects to your Anycubic Cloud account. Prepare models in your slicer, then use the workshop to browse files, track prints and manage your ACE.

[Français](README.md) · [Version 2.1.1 and changelog](CHANGELOG.md) · [Releases](https://github.com/mcflykid/anycubic-cloud-page/releases) · [Screenshots](screenshots/README.md)

![Desktop overview with demo data](screenshots/atelier/resume.jpg)

## Install with Docker Compose

Use an Anycubic account with a linked printer and a Linux Docker host on **amd64 or arm64**. In an empty directory, download the Compose file and configuration template.

```sh
curl -fL https://github.com/mcflykid/anycubic-cloud-page/releases/latest/download/compose.yaml -o compose.yaml
curl -fL https://github.com/mcflykid/anycubic-cloud-page/releases/latest/download/default.env.example -o .env.example
cp .env.example .env
chmod 600 .env
```

1. Enter `ANYCUBIC_EMAIL` and `ANYCUBIC_PASSWORD` in `.env` and set a separate `WEB_PASSWORD`. The default web username is `admin`.
2. Run `docker compose up -d`.
3. Open [the workshop on your Docker host](http://localhost:8080/imprimante.html). The service listens on the local interface by default.

Persistent data is stored in `./appdata`. To pin a release, set `APP_IMAGE` to its image tag in `.env`. For access from another device, configure an HTTPS reverse proxy and the matching public origin. [Installation guide](docs/INSTALLATION.md) · [HTTPS proxy](docs/REVERSE-PROXY.md) · [Anycubic sign-in](docs/CLOUD-CONNECTION.md)

## What you can do

- Track progress, layers, estimated finish, temperatures, fans and print phases. Display the wall view or use available printer controls.
- View ACE slots, recognized RFID spools and reported remaining amounts. Browse the Anycubic catalogue, create filament profiles and see drying suggestions.
- Browse printer memory, USB and cloud storage. File actions depend on source and format. Launch supported sliced files.
- Open the live camera, search print history, review print details and configure Discord notifications.
- Review fleet health and measurements, set up two-factor sign-in, and read firmware notes when Anycubic provides them.

The reference setup is a **Kobra S1 with ACE 2 Pro**. Available operations depend on the device and firmware. A short run submitted the timelapse option without an observed clip. Combined print-and-dry modes remain unavailable. [Compatibility](docs/COMPATIBILITY.md) · [Filament profiles](docs/FICHES-FILAMENT.md) · [Notifications](docs/NOTIFICATIONS.md)

## Try the demo

From the repository, with Python 3.13:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r app/requirements.txt
python app/demo.py
```

Open [the local demo](http://127.0.0.1:8081). It uses synthetic data and requires no printer or Anycubic account.

Independent community project under [GPL-3.0-or-later](LICENSE). Its cloud engine derives from [hass-anycubic_cloud_v3](https://github.com/ljschmitt/hass-anycubic_cloud_v3). [Third-party notices](THIRD_PARTY_NOTICES.md) · [Contributing](CONTRIBUTING.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](SECURITY.md)
