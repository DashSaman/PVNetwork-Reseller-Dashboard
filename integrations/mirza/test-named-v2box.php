<?php

require_once __DIR__ . '/pvnetwork-v2box.php';

function equal($actual, $expected, string $name): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($name);
    }
    echo "PASS $name\n";
}

$panel = [
    'type' => 'x-ui_single',
    'sublink' => 'onsublink',
    'url_panel' => 'https://dashboard.example.test/api/bridge/test',
    'password_panel' => 'pvnet_bridge_fixture',
    'linksubx' => 'https://native.example.test:4020/native-sub/',
];
$native = 'https://native.example.test:4020/native-sub/new-fixture-01';
$original = json_encode(['inline_keyboard' => [[['text' => 'Help', 'callback_data' => 'help']]]]);
$result = pvnetwork_named_v2box_keyboard($panel, $native . "\nvless://fixture", $original);
$decoded = json_decode($result, true, 512, JSON_THROW_ON_ERROR);
equal($decoded['inline_keyboard'][0][0], [
    'text' => 'افزودن با نام در V2Box',
    'url' => 'https://dashboard.example.test/s/new-fixture-01/v2box',
], 'trial selects the native URL before any direct configs');
equal($decoded['inline_keyboard'][1], json_decode($original, true)['inline_keyboard'][0], 'original keyboard preserved');
equal(pvnetwork_named_v2box_keyboard($panel, $native, $result), $result, 'no duplicate launcher button');
equal(count(json_decode(pvnetwork_named_v2box_keyboard($panel, $native, null), true)['inline_keyboard']), 1, 'launcher still attaches when help is disabled');
equal(pvnetwork_named_v2box_keyboard($panel, $native . '?override=1', $original), $original, 'foreign subscription form rejected');
equal(pvnetwork_named_v2box_keyboard($panel, 'https://elsewhere.example/test/native-sub/new-fixture-01', $original), $original, 'foreign subscription origin rejected');
equal(pvnetwork_named_v2box_keyboard(array_replace($panel, ['sublink' => 'off']), $native, $original), $original, 'hidden subscription stays hidden');
equal(pvnetwork_named_v2box_keyboard(array_replace($panel, ['password_panel' => 'another_driver']), $native, $original), $original, 'unrelated Mirza connector unchanged');
equal(pvnetwork_named_v2box_keyboard($panel, $native, '{"keyboard":[]}'), '{"keyboard":[]}', 'a non-inline keyboard is preserved');
