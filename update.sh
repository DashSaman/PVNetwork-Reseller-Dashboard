#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/pv-reseller}"
INSTALLER_URL="https://raw.githubusercontent.com/DashSaman/PVNetwork-Reseller-Dashboard/main/install.sh"

echo "[PVNetwork] Downloading the latest dashboard-only installer..."
INSTALL_DIR="$INSTALL_DIR" bash <(curl -fsSL "$INSTALLER_URL")
