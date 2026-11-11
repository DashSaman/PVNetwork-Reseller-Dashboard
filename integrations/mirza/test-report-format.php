<?php
// Evaluate only the installed sale-error formatting expression. No bot config,
// PDO, wallet, orders, Telegram or HTTP is loaded by this test.
require $argv[1]; // standalone connector helper
$source = file_get_contents($argv[2]);
$marker = '$dataoutput[\'msg\'] = json_encode($dataoutput[\'msg\'] ?? $dataoutput ?? \'unknown error\'';
$start = strpos($source, $marker);
if ($start === false) throw new Exception('Missing sale-error boundary');
$expression = substr($source, $start, strpos($source, ';', $start) - $start + 1);
$bridge = ['url_panel' => 'https://fixture.example/api/bridge/demo', 'password_panel' => 'pvnet_bridge_' . str_repeat('a', 64)];
$reason = 'HTTP 503: لوکیشن فعلاً در دسترس نیست';
$marzban_list_get = $bridge;
$dataoutput = ['msg' => $reason];
eval($expression);
if (!str_contains($dataoutput['msg'], 'لوکیشن') || str_contains($dataoutput['msg'], '\\u06')) throw new Exception('Persian bridge reason became escaped Unicode');
echo "PASS bridge sale-error report retains readable Persian\n";
$marzban_list_get = ['url_panel' => 'https://ordinary.example', 'password_panel' => 'ordinary-key'];
$dataoutput = ['msg' => $reason];
eval($expression);
if ($dataoutput['msg'] !== json_encode($reason)) throw new Exception('Unrelated panel error formatting changed');
echo "PASS unrelated panel formatting is unchanged\n";
