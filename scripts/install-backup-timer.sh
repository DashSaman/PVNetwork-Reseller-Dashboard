#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/pv-reseller}"
CONTAINER_NAME="${CONTAINER_NAME:-pv-reseller-dashboard}"
[[ "$INSTALL_DIR" = /* && "$INSTALL_DIR" != / && "$INSTALL_DIR" != *$'\n'* ]] || { echo 'Invalid install directory' >&2; exit 1; }
[[ "$CONTAINER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 1; }
command -v systemctl >/dev/null
DOCKER_BIN="$(command -v docker)"
"$DOCKER_BIN" inspect "$CONTAINER_NAME" >/dev/null
install -d -m 700 "$INSTALL_DIR/data/backups"
cat > /etc/systemd/system/pv-reseller-backup.service <<EOF
[Unit]
Description=PVNetWork reseller dashboard backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$DOCKER_BIN exec $CONTAINER_NAME node /app/scripts/run-backup.cjs
User=root
UMask=0077
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=420
StandardOutput=journal
StandardError=journal
EOF
cat > /etc/systemd/system/pv-reseller-backup.timer <<'EOF'
[Unit]
Description=Daily PVNetWork backup with five-day archive retention

[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Tehran
Persistent=true
AccuracySec=1min
Unit=pv-reseller-backup.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify /etc/systemd/system/pv-reseller-backup.service /etc/systemd/system/pv-reseller-backup.timer
systemctl daemon-reload
systemctl enable --now pv-reseller-backup.timer
systemctl is-active --quiet pv-reseller-backup.timer
printf '{"enabled":true,"dailyTime":"03:00","timezone":"Asia/Tehran","retentionDays":5}\n' > "$INSTALL_DIR/data/backups/schedule.json"
chmod 600 "$INSTALL_DIR/data/backups/schedule.json"
echo 'PVNetWork backup timer enabled: daily 03:00 Asia/Tehran; archive retention 5 days'
