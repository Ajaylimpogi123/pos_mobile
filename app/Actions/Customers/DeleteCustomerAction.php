<?php

namespace App\Actions\Customers;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Customer;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a customer and writes a `customer.deleted` audit entry.
 */
class DeleteCustomerAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Customer $customer, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($customer, $actor, $ip): void {
            $customer->forceFill(['updated_by' => $actor->id])->save();
            $customer->delete();

            $this->recordAuditLog->execute(
                action: 'customer.deleted',
                actor: $actor,
                subject: $customer,
                changes: ['full_name' => $customer->full_name],
                ip: $ip,
            );
        });
    }
}
