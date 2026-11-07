<?php
/** Mirza 0.8.1: refresh a saved PVNetwork selection before every sale/trial.
 * No routing/protocol configuration or bot business records are changed here.
 */
function pvnetwork_is_sales_bridge(array $panel): bool
{
    return preg_match('~^/api/bridge/[^/]+/?$~', (string) parse_url($panel['url_panel'] ?? '', PHP_URL_PATH)) === 1
        && str_starts_with((string) ($panel['password_panel'] ?? ''), 'pvnet_bridge_');
}

function pvnetwork_current_selection(array $panel, $selection): array
{
    $ids = is_array($selection) ? $selection : json_decode((string) $selection, true);
    if (!is_array($ids) || !$ids || array_filter($ids, fn($id) => !is_int($id) || $id <= 0)) {
        return ['ok' => false, 'response' => ['status' => 400, 'body' => json_encode(['success' => false, 'msg' => 'لوکیشن‌های فروش تنظیم نشده‌اند؛ تنظیم پروتکل و اینباند را بررسی کنید'], JSON_UNESCAPED_UNICODE)]];
    }
    $request = new CurlRequest(rtrim($panel['url_panel'], '/') . '/panel/api/inbounds/list');
    $request->setBearerToken($panel['password_panel']);
    $response = $request->get();
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
