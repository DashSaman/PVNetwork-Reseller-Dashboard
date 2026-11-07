<?php
// Isolated wire test: no PDO, Telegram, network, orders or wallet writes.
$request_exec_timeout = null;
class CurlRequest {
    public static array $responses = [];
    public static array $calls = [];
    private int $index;
    function __construct($url) { global $request_exec_timeout;$this->index = count(self::$calls);self::$calls[] = ['url' => $url, 'timeout' => $request_exec_timeout ?: 10000]; }
    function setHeaders($headers) {}
    function setBearerToken($token) {}
    function get() { return array_shift(self::$responses); }
    function post($body) { self::$calls[$this->index]['body'] = json_decode($body, true);return array_shift(self::$responses); }
}
require $argv[1];
$panel = ['url_panel' => 'https://fixture.example/api/bridge/demo', 'password_panel' => 'pvnet_bridge_' . str_repeat('a', 64), 'on_hold_test' => '1', 'conecton' => 'onconecton'];
$catalog = ['status' => 200, 'body' => json_encode(['success' => true, 'obj' => [['id' => 7], ['id' => 9]]])];
$failed = ['status' => 400, 'body' => json_encode(['success' => false, 'msg' => 'موجودی کافی نیست'])];
CurlRequest::$responses = [$catalog, $failed];
$result = addClient($panel, 'sample_customer', time() + 3600, 'sample_sub', 1073741824, '[7,8,9]', 'usertest');
function ensure($ok, $message) { if (!$ok) { fwrite(STDERR, "FAIL: $message\n");exit(1); }echo "PASS: $message\n"; }
ensure(str_contains($result['error'] ?? '', 'موجودی کافی نیست'), 'actual addClient preserves the API rejection reason for the existing driver');
ensure(CurlRequest::$calls[1]['timeout'] >= 45000 && $request_exec_timeout === null, 'bridge call has bounded timeout margin and restores the global setting');
ensure(CurlRequest::$calls[1]['body']['inboundIds'] === [7,9], 'sale uses only saved locations that remain available');
ensure(CurlRequest::$calls[1]['body']['client']['expiryTime'] < 0 && abs(CurlRequest::$calls[1]['body']['client']['expiryTime']) <= 3600000, 'hourly first-use trial stays hourly');
ensure(count(CurlRequest::$calls) === 2, 'a rejected sale is never blindly retried');
CurlRequest::$responses = [['status' => 200, 'body' => '<html>private proxy content</html>']];
$result = get_clinets('sample_customer', $panel);
ensure(str_contains($result['error'] ?? '', 'پاسخ معتبر') && !str_contains($result['error'], 'private'), 'malformed successful HTTP reply never becomes an accepted sale');
CurlRequest::$calls = [];CurlRequest::$responses = [['status' => null, 'body' => null, 'error' => 'curl: private upstream details']];
$result = get_clinets('sample_customer', $panel);
ensure(str_contains($result['error'] ?? '', 'پاسخ قطعی') && !str_contains($result['error'], 'private'), 'unknown transport outcome is explicit and omits private transport details');
$ordinary = $panel;$ordinary['url_panel'] = 'https://ordinary.example';$ordinary['password_panel'] = 'ordinary-token';
CurlRequest::$calls = [];CurlRequest::$responses = [$failed];
$result = get_clinets('sample_customer', $ordinary);
ensure($result === $failed && CurlRequest::$calls[0]['timeout'] === 10000, 'ordinary x-ui connections keep their original response and timeout');
$request_exec_timeout = 60000;CurlRequest::$calls = [];CurlRequest::$responses = [$catalog, ['status' => 200, 'body' => '{"success":true}']];
$result = addClient($panel, 'sample_customer', time()+3600, 'sample_sub', 1073741824, '[7]', 'usertest');
ensure(CurlRequest::$calls[1]['timeout'] === 60000 && $request_exec_timeout === 60000 && !isset($result['error']), 'a longer configured timeout and successful wire reply are retained');
