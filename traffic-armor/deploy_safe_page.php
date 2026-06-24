<?php
/**
 * Safe Page Deploy Endpoint
 * Called by MVMT Printer backend to push safe page HTML + campaign mapping.
 *
 * POST /deploy_safe_page.php
 * Headers: X-Deploy-Key: <secret>
 * Body: JSON { "domain": "example.com", "campaign_id": "abc123", "html": "<html>..." }
 *
 * Or legacy plain HTML body (writes to generic safe_page.html).
 */

// Verify deploy key
$deploy_key = getenv('DEPLOY_SECRET_KEY');
if (!$deploy_key) {
    http_response_code(500);
    echo json_encode(['error' => 'DEPLOY_SECRET_KEY not configured']);
    exit;
}
$provided_key = $_SERVER['HTTP_X_DEPLOY_KEY'] ?? '';

if (!hash_equals($deploy_key, $provided_key)) {
    http_response_code(403);
    echo json_encode(['error' => 'Invalid deploy key']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$body = file_get_contents('php://input');
if (empty($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Empty body']);
    exit;
}

header('Content-Type: application/json');

// Try JSON format (new): { domain, campaign_id, html }
$data = json_decode($body, true);
if ($data && isset($data['domain']) && isset($data['campaign_id']) && isset($data['html'])) {
    $domain = preg_replace('/[^a-zA-Z0-9._-]/', '', $data['domain']); // sanitize
    $campaign_id = $data['campaign_id'];
    $html = $data['html'];

    // 1. Write per-domain safe page (both locations for resilience)
    foreach ([__DIR__ . '/safe_pages', '/tmp/safe_pages'] as $safe_dir) {
        if (!is_dir($safe_dir)) {
            mkdir($safe_dir, 0777, true);
        }
        file_put_contents($safe_dir . '/' . $domain . '.html', $html);
    }
    $bytes = strlen($html);

    // 2. Update domain→campaign mapping (both locations)
    foreach ([__DIR__ . '/campaigns.json', '/tmp/campaigns.json'] as $map_file) {
        $map = [];
        if (file_exists($map_file)) {
            $map = json_decode(file_get_contents($map_file), true) ?: [];
        }
        $map[$domain] = $campaign_id;
        file_put_contents($map_file, json_encode($map, JSON_PRETTY_PRINT));
    }

    echo json_encode([
        'success' => true,
        'domain' => $domain,
        'campaign_id' => $campaign_id,
        'safe_page_bytes' => $bytes,
        'message' => "Deployed safe page for {$domain} → campaign {$campaign_id}",
    ]);
    exit;
}

// Legacy: plain HTML body → writes to generic safe_page.html
$path = __DIR__ . '/safe_page.html';
$bytes = file_put_contents($path, $body);

if ($bytes === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write file']);
    exit;
}

echo json_encode([
    'success' => true,
    'bytes' => $bytes,
    'message' => 'Safe page deployed (generic)',
]);
