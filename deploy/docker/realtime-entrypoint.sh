#!/bin/sh
# Entry point for the realtime gateway release.
#
# Clustering is a deployment concern, so it is settled here rather than in the
# release: when CLUSTER_DNS is set (ECS, behind Cloud Map) every node needs a
# routable long name and the same cookie, and Erlang distribution has to stay
# inside the port range the security group opens. A single node (self-host)
# keeps the defaults and never listens beyond its container.
set -eu

if [ -z "${RELEASE_COOKIE:-}" ] && [ -n "${SECRET_KEY_BASE:-}" ]; then
    # Derived, never baked into the image: the cookie in a public image is a
    # public cookie. Every node with the same SECRET_KEY_BASE agrees on it.
    RELEASE_COOKIE=$(printf '%s' "opendesk-realtime-cookie:${SECRET_KEY_BASE}" | sha256sum | cut -c1-64)
    export RELEASE_COOKIE
fi

if [ -n "${CLUSTER_DNS:-}" ]; then
    ip=${POD_IP:-$(hostname -i 2>/dev/null | awk '{print $1}')}
    export RELEASE_DISTRIBUTION=name
    export RELEASE_NODE="${RELEASE_NODE_BASENAME:-realtime}@${ip}"
    export ELIXIR_ERL_OPTIONS="${ELIXIR_ERL_OPTIONS:-} -kernel inet_dist_listen_min ${DIST_PORT_MIN:-9100} inet_dist_listen_max ${DIST_PORT_MAX:-9155}"
fi

exec /app/bin/"${RELEASE_NAME:-realtime}" "$@"
