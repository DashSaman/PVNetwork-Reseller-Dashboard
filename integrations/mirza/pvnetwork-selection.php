<?php
/** Mirza 0.8.1: refresh a saved PVNetwork selection before every sale/trial.
 * No routing/protocol configuration or bot business records are changed here.
 */
function pvnetwork_is_sales_bridge(array $panel): bool
{
    return preg_match('~^/api/bridge/[^/]+/?$~', (string) parse_url($panel['url_panel'] ?? '', PHP_URL_PATH)) === 1
        && str_starts_with((string) ($panel['password_panel'] ?? ''), 'pvnet_bridge_');
}

/** CurlRequest captures this global in its constructor. Restore it immediately;
 * no other panel or subsequent bot request inherits the bridge timeout. */
function pvnetwork_curl_request(array $panel, string $url): CurlRequest
{
    if (!pvnetwork_is_sales_bridge($panel)) return new CurlRequest($url);
    $hadTimeout = array_key_exists('request_exec_timeout', $GLOBALS);
    $previous = $GLOBALS['request_exec_timeout'] ?? null;
    try {
        $GLOBALS['request_exec_timeout'] = max(45000, (int) $previous);
        return new CurlRequest($url);
    } finally {
        if ($hadTimeout) $GLOBALS['request_exec_timeout'] = $previous;
        else unset($GLOBALS['request_exec_timeout']);
    }
}

/** Existing Mirza drivers check error before status; retain a useful, bounded
 * rejection reason instead of reducing every API rejection to the number 400. */
function pvnetwork_api_response(array $panel, array $response): array
{
    if (!pvnetwork_is_sales_bridge($panel)) return $response;
    $status = (int) ($response['status'] ?? 0);
    if (!$status || !empty($response['error'])) {
        $response['error'] = 'پاسخ قطعی دریافت نشد؛ پیش از تکرار ساخت یا پرداخت، فهرست کاربران پنل را بررسی کنید';
        return $response;
    }
    $body = json_decode($response['body'] ?? '', true);
    if (!is_array($body) || !is_bool($body['success'] ?? null)) {
        $response['error'] = 'پاسخ معتبر دریافت نشد؛ پیش از تکرار ساخت، فهرست کاربران پنل را بررسی کنید';
        return $response;
    }
    if ($status !== 200 || ($body['success'] ?? null) === false) {
        $reason = is_string($body['msg'] ?? null) ? trim(strip_tags($body['msg'])) : '';
        // Avoid logging HTML, full response bodies, tokens or transport details.
        if (!$reason || strlen($reason) > 1200 || str_contains($reason, 'pvnet_bridge_')) $reason = 'درخواست تأیید نشد؛ وضعیت اتصال، لوکیشن‌ها و موجودی را بررسی کنید';
        $response['error'] = 'HTTP ' . $status . ': ' . htmlspecialchars($reason, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
    return $response;
}

function pvnetwork_current_selection(array $panel, $selection): array
{
    $ids = is_array($selection) ? $selection : json_decode((string) $selection, true);
    if (!is_array($ids) || !$ids || array_filter($ids, fn($id) => !is_int($id) || $id <= 0)) {
        return ['ok' => false, 'response' => ['status' => 400, 'body' => json_encode(['success' => false, 'msg' => 'لوکیشن‌های فروش تنظیم نشده‌اند؛ تنظیم پروتکل و اینباند را بررسی کنید'], JSON_UNESCAPED_UNICODE)]];
    }
    $request = pvnetwork_curl_request($panel, rtrim($panel['url_panel'], '/') . '/panel/api/inbounds/list');
    $request->setBearerToken($panel['password_panel']);
    $response = pvnetwork_api_response($panel, $request->get());
    $body = json_decode($response['body'] ?? '', true);
    if (($response['status'] ?? 0) !== 200 || ($body['success'] ?? false) !== true || !is_array($body['obj'] ?? null)) {
        return ['ok' => false, 'response' => $response];
    }
    $available = array_column($body['obj'], 'id');
    $selected = array_values(array_unique(array_filter($ids, fn($id) => in_array($id, $available, true))));
    if (!$selected) {
        return ['ok' => false, 'response' => ['status' => 503, 'body' => json_encode(['success' => false, 'msg' => 'هیچ‌کدام از لوکیشن‌های فروش فعلاً در دسترس نیست؛ موجودی تغییر نکرد'], JSON_UNESCAPED_UNICODE)]];
    }
    return ['ok' => true, 'ids' => $selected];
}
