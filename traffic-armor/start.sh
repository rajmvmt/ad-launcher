#!/bin/bash
# Startup script — sets Apache to listen on Railway's $PORT at runtime

PORT="${PORT:-8080}"

# Update Apache config to use the correct port
sed -i "s/Listen 80/Listen $PORT/" /etc/apache2/ports.conf
sed -i "s/:80/:$PORT/" /etc/apache2/sites-available/000-default.conf

echo "Starting Apache on port $PORT"
exec apache2-foreground
