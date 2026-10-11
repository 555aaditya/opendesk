#!/bin/bash
# Container health check for the realtime gateway: GET /health must answer 200.
# The runtime image has no curl or wget, and does not need them for this.
set -eu
exec 3<>"/dev/tcp/127.0.0.1/${PORT:-4000}"
printf 'GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
IFS= read -r -t 3 status <&3
case "$status" in
    "HTTP/1."?" 200"*) exit 0 ;;
    *) exit 1 ;;
esac
