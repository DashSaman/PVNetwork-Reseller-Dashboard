<?php

require_once __DIR__ . '/pvnetwork-selection.php';

/** Append the HTTPS launch button to an existing Mirza service keyboard. */
function pvnetwork_named_v2box_keyboard(array $panel, $subscription, $replyMarkup)
{
    if (($panel['type'] ?? null) !== 'x-ui_single' || ($panel['sublink'] ?? null) !== 'onsublink'
        || !pvnetwork_is_sales_bridge($panel) || !is_string($subscription)) {
        return $replyMarkup;
    }

    $bridgeUrl = $panel['url_panel'];
    if (!preg_match('~^(https://[A-Za-z0-9.-]+(?::[0-9]+)?)/api/bridge/[A-Za-z0-9_.-]+/?$~D', $bridgeUrl, $bridge)) {
        return $replyMarkup;
    }

    $nativeBase = rtrim(trim((string) ($panel['linksubx'] ?? '')), '/');
    if (!preg_match('~^https?://[^\s?#]+$~D', $nativeBase)) {
        return $replyMarkup;
    }

    // Trial deliveries may append individual configs below the original URL.
    $firstLine = trim(substr($subscription, 0, strcspn($subscription, "\r\n")));
    if (!preg_match('~^' . preg_quote($nativeBase, '~') . '/([A-Za-z0-9_-]{8,128})$~D', $firstLine, $match)) {
        return $replyMarkup;
    }

    $keyboard = $replyMarkup === null ? ['inline_keyboard' => []]
        : (is_string($replyMarkup) ? json_decode($replyMarkup, true) : null);
    if (!is_array($keyboard['inline_keyboard'] ?? null)) {
        return $replyMarkup;
    }

    $url = $bridge[1] . '/s/' . $match[1] . '/v2box';
    foreach ($keyboard['inline_keyboard'] as $row) {
        if (!is_array($row)) {
            return $replyMarkup;
        }
        foreach ($row as $button) {
            if (($button['url'] ?? null) === $url) {
                return $replyMarkup;
            }
        }
    }
    array_unshift($keyboard['inline_keyboard'], [['text' => 'افزودن با نام در V2Box', 'url' => $url]]);
    return json_encode($keyboard, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: $replyMarkup;
}
