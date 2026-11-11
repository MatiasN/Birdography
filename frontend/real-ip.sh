#!/bin/sh
# When another reverse proxy sits in front of this container, take the client address from its X-Forwarded-For,
# but only for requests coming from TRUSTED_PROXIES (IPs or CIDRs, separated by spaces or commas). Without it,
# every request appears to come from the proxy and all of them share one login throttle bucket.
set -eu
conf=/etc/nginx/conf.d/real-ip.conf
: >"$conf"
for proxy in $(echo "${TRUSTED_PROXIES:-}" | tr ',' ' '); do
    if ! echo "$proxy" | grep -Eq '^[0-9A-Fa-f.:]+(/[0-9]+)?$'; then
        echo "real-ip.sh: invalid address in TRUSTED_PROXIES: $proxy" >&2
        exit 1
    fi
    echo "set_real_ip_from $proxy;" >>"$conf"
done
if [ -s "$conf" ]; then
    printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >>"$conf"
fi
