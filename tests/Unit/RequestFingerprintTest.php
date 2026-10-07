<?php

use App\Support\RequestFingerprint;

it('ignores key order at every depth but keeps list order', function () {
    $a = ['ulid' => 'X', 'items' => [['product_id' => 1, 'qty' => 2], ['product_id' => 3, 'qty' => 1]], 'discount' => ['kind' => 'amount', 'type' => 'promo', 'value' => 5]];
    $b = ['discount' => ['value' => 5, 'type' => 'promo', 'kind' => 'amount'], 'items' => [['qty' => 2, 'product_id' => 1], ['qty' => 1, 'product_id' => 3]], 'ulid' => 'X'];
    $swapped = [...$a, 'items' => array_reverse($a['items'])];

    expect(RequestFingerprint::of($a))->toBe(RequestFingerprint::of($b))
        ->and(RequestFingerprint::of($a))->not->toBe(RequestFingerprint::of($swapped))
        ->and(RequestFingerprint::of($a))->toMatch('/^[0-9a-f]{64}$/');
});

it('ignores any pin field, at any depth', function () {
    $body = ['user_id' => 3, 'discount_authorization' => ['user_id' => 2, 'pin' => '2468']];

    expect(RequestFingerprint::of($body))
        ->toBe(RequestFingerprint::of(['user_id' => 3, 'discount_authorization' => ['user_id' => 2, 'pin' => '9999']]))
        ->toBe(RequestFingerprint::of(['user_id' => 3, 'discount_authorization' => ['user_id' => 2]]))
        ->and(RequestFingerprint::of(['pin' => '1234', 'user_id' => 3]))->toBe(RequestFingerprint::of(['user_id' => 3]));
});

it('tells different values and types apart', function () {
    expect(RequestFingerprint::of(['qty' => 1]))->not->toBe(RequestFingerprint::of(['qty' => 2]))
        ->and(RequestFingerprint::of(['qty' => 1]))->not->toBe(RequestFingerprint::of(['qty' => '1']))
        ->and(RequestFingerprint::of(['notes' => null]))->not->toBe(RequestFingerprint::of([]));
});
