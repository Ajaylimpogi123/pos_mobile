<?php

use App\Actions\Audit\RecordAuditLog;
use App\Models\Category;
use App\Models\Printer;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    mainBranch();
    // 2026-09-25 10:00 in Manila: business day 2026-09-25.
    Carbon::setTestNow('2026-09-25 02:00:00');

    $this->owner = userWithRole('owner');
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->token = tokenFor($this->manager);
});

afterEach(function () {
    Carbon::setTestNow();
});

it('summarises printer and receipt settings changes in the activity feed', function () {
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $tick = fn () => Carbon::setTestNow(now()->addSecond());

    $kitchenId = $this->withToken($this->token)
        ->postJson('/api/v1/admin/printers', ['name' => 'Kitchen', 'role' => 'kitchen', 'host' => '192.168.1.60'])
        ->assertCreated()
        ->json('data.id');
    $tick();
    $barId = $this->withToken($this->token)
        ->postJson('/api/v1/admin/printers', ['name' => 'Bar', 'role' => 'bar', 'host' => '192.168.1.61', 'category_ids' => [$drinks->id]])
        ->assertCreated()
        ->json('data.id');
    $tick();
    $this->withToken($this->token)->patchJson("/api/v1/admin/printers/{$kitchenId}", ['port' => 9101])->assertOk();
    $tick();
    $this->withToken($this->token)->patchJson('/api/v1/admin/settings', ['receipt_copies' => 2])->assertOk();
    $tick();
    $this->withToken($this->token)->deleteJson("/api/v1/admin/printers/{$barId}")->assertNoContent();

    $response = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk();

    expect(collect($response->json('data.activity.recent_changes'))->map(fn (array $c) => [$c['action'], $c['summary'], $c['actor_name']])->all())
        ->toBe([
            ['printer.deleted', 'Removed printer "Bar"', 'Marco Manager'],
            ['settings.updated', 'Updated the receipt settings', 'Marco Manager'],
            ['printer.updated', 'Updated printer "Kitchen"', 'Marco Manager'],
            ['printer.created', 'Added printer "Bar"', 'Marco Manager'],
            ['printer.created', 'Added printer "Kitchen"', 'Marco Manager'],
        ])
        ->and(collect($response->json('data.activity.changes_by_day'))->last())->toBe(['date' => '2026-09-25', 'count' => 5]);
});

it('uses the live name of a renamed printer, then the snapshot name, then a generic noun', function () {
    $audit = app(RecordAuditLog::class);
    $tick = fn () => Carbon::setTestNow(now()->addSecond());

    $kitchen = Printer::factory()->create(['name' => 'Kitchen']);
    $audit->execute('printer.updated', $this->manager, $kitchen, ['port' => ['from' => 9100, 'to' => 9101]]);
    $tick();

    // Subject rows gone for good: fall back to the snapshot name, then to "a printer".
    $old = Printer::factory()->create(['name' => 'Old Bar']);
    $audit->execute('printer.deleted', $this->manager, $old, ['name' => 'Old Bar']);
    $old->forceDelete();
    $tick();
    $ghost = Printer::factory()->create(['name' => 'Ghost']);
    $audit->execute('printer.created', $this->manager, $ghost, ['port' => ['from' => null, 'to' => 9100]]);
    $ghost->forceDelete();

    $kitchen->forceFill(['name' => 'Hot Line'])->save();

    $summaries = collect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk()->json('data.activity.recent_changes'))
        ->pluck('summary')
        ->all();

    expect($summaries)->toBe(['Added a printer', 'Removed printer "Old Bar"', 'Updated printer "Hot Line"']);
});
