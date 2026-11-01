#!/usr/bin/env bash
set -euo pipefail
CONTAINER_NAME="${CONTAINER_NAME:-pv-reseller-dashboard}"
[[ "$CONTAINER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 1; }
DOCKER_BIN="$(command -v docker)"
"$DOCKER_BIN" inspect "$CONTAINER_NAME" >/dev/null
cat > /etc/systemd/system/pv-reseller-observations.service <<EOF
[Unit]
Description=PVNetwork customer usage observations and threshold alerts
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
SuccessExitStatus=2
ExecStart=$DOCKER_BIN exec $CONTAINER_NAME node /app/scripts/run-customer-observations.cjs
User=root
UMask=0077
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=960
StandardOutput=journal
StandardError=journal
EOF
cat > /etc/systemd/system/pv-reseller-observations.timer <<'EOF'
[Unit]
Description=Collect PVNetwork customer usage every 30 minutes

[Timer]
OnCalendar=*-*-* *:00,30:00
Persistent=true
RandomizedDelaySec=60
Unit=pv-reseller-observations.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify /etc/systemd/system/pv-reseller-observations.service /etc/systemd/system/pv-reseller-observations.timer
systemctl daemon-reload
systemctl enable --now pv-reseller-observations.timer
systemctl is-active --quiet pv-reseller-observations.timer
echo 'PVNetwork observation/alert timer enabled; no listening ports added'
