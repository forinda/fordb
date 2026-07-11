# Install

## Linux — apt / dnf

Add the repository once; new versions then arrive with a normal system update.

```bash
# Debian / Ubuntu
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.deb.sh' | sudo -E bash
sudo apt update && sudo apt install fordb

# Fedora / RHEL
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.rpm.sh' | sudo -E bash
sudo dnf install fordb
```

## Direct download

Grab a standalone `.AppImage` / `.deb` / `.rpm` / Windows `.exe` from the [Releases](https://github.com/forinda/fordb/releases) page. Each release ships a `SHA256SUMS` file:

```bash
grep <file> SHA256SUMS | sha256sum -c -
```
