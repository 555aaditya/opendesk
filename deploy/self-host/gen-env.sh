#!/bin/sh
# Writes a self-host .env for docker-compose.yml from deploy/self-host/.env.template,
# with fresh secrets.
#
#   sh deploy/self-host/gen-env.sh [output] [domain]      (make selfhost-env)
#
# An existing file is never rewritten: only the self-host keys it lacks, or has
# empty, are added. That keeps a development .env (copied from .env.example)
# working for both `go run` and `docker compose`, and it means a secret that is
# already set is never regenerated. A new CREDENTIALS_KEY would make every
# stored mailbox credential unreadable.
set -eu

main() {
    here=$(cd "$(dirname "$0")" && pwd)
    out=${1:-.env}
    domain=${2:-localhost}
    command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
    case "$domain" in
        :*) url="http://localhost${domain#:80}"; gw="ws://localhost${domain#:80}/socket" ;;
        *) url="https://$domain"; gw="wss://$domain/socket" ;;
    esac

    if [ ! -e "$out" ]; then
        umask 077
        sed \
            -e "s|^OPENDESK_DOMAIN=.*|OPENDESK_DOMAIN=$domain|" \
            -e "s|^OPENDESK_URL=.*|OPENDESK_URL=$url|" \
            -e "s|^OPENDESK_GATEWAY_URL=.*|OPENDESK_GATEWAY_URL=$gw|" \
            "$here/.env.template" >"$out"
        echo "wrote $out for $url"
    fi

    added=""
    fill() {
        # fill KEY VALUE: set KEY only when it is missing or empty.
        if ! grep -q "^$1=..*" "$out"; then
            if grep -q "^$1=$" "$out"; then
                tmp="$out.tmp.$$"
                (umask 077; sed "s|^$1=$|$1=$2|" "$out" >"$tmp")
                mv "$tmp" "$out"
            else
                printf '%s=%s\n' "$1" "$2" >>"$out"
            fi
            added="$added $1"
        fi
    }
    fill OPENDESK_DOMAIN "$domain"
    fill OPENDESK_URL "$url"
    fill OPENDESK_GATEWAY_URL "$gw"
    fill AUTH_SECRET "$(openssl rand -hex 32)"
    fill CREDENTIALS_KEY "$(openssl rand -hex 32)"
    fill SECRET_KEY_BASE "$(openssl rand -hex 48)"
    fill NATS_TOKEN "$(openssl rand -hex 24)"
    fill INBOUND_SECRET "$(openssl rand -hex 24)"
    fill POSTGRES_PASSWORD "$(openssl rand -hex 20)"
    chmod 600 "$out"
    if [ -n "$added" ]; then
        echo "set in $out:$added"
        echo "Back it up: it holds the only copy of CREDENTIALS_KEY."
    else
        echo "$out already has every self-host setting; nothing changed."
    fi
}

main "$@"
