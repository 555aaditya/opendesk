#!/bin/sh
# Regenerates deploy/install/install.sh.sha256 (make installer-sha). The file
# is what makes "download, verify, read, run" a real alternative to piping the
# installer into a shell; CI fails when it disagrees with install.sh.
set -eu

main() {
    cd "$(dirname "$0")"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum install.sh >install.sh.sha256
    else
        shasum -a 256 install.sh >install.sh.sha256
    fi
    cat install.sh.sha256
}

main "$@"
