<?php
/**
 * Router for PHP built-in server.
 * Replaces Apache .htaccess rewriting.
 * All requests route through index.php (TA cloaker entry point).
 */

$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// Health check
if ($path === '/health.php' || $path === '/health') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'service' => 'traffic-armor-php']);
    return true;
}

// Safe page deploy endpoint
if ($path === '/deploy_safe_page.php' || $path === '/deploy_safe_page') {
    require __DIR__ . '/deploy_safe_page.php';
    return true;
}

// JS integration endpoint: /track or /track/{campaign_id}
// Serves TA's JavaScript to browsers. Same file for all campaigns.
if (preg_match('#^/track(/([a-z0-9]+))?$#', $path, $m)) {
    // Campaign ID from URL path or query param or default
    $GLOBALS['_js_campaign_id'] = $m[2] ?? ($_GET['c'] ?? null);
    require __DIR__ . '/js_track.php';
    return true;
}

// Serve actual static files if they exist (css, js, images)
if ($path !== '/' && file_exists(__DIR__ . $path) && !is_dir(__DIR__ . $path) && !preg_match('/\.php$/', $path)) {
    return false; // Let PHP built-in server handle static files
}

// Everything else goes through TA's index.php
require __DIR__ . '/index.php';
return true;
