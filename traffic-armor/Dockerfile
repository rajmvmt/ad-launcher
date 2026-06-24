# Traffic Armor PHP Cloaker — Railway Service
# Uses PHP built-in server (zero Apache config issues)

FROM php:8.2-cli

# Install curl extension (bootloader needs it to download core from srvjs.com)
RUN apt-get update && apt-get install -y libcurl4-openssl-dev && \
    docker-php-ext-install curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set tmp writable (TA hybrid mode + bootloader cache)
RUN chmod 777 /tmp

WORKDIR /var/www/html

# Copy all application files
COPY . /var/www/html/

# Ensure tmp dir exists and is writable
RUN mkdir -p /var/www/html/tmp && chmod 777 /var/www/html/tmp

CMD php -S 0.0.0.0:${PORT:-8080} router.php
