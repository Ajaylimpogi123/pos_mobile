<?php

namespace App\Actions\Customers;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Customer;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update to a customer. Only the fields actually changed are
 * written to the `customer.updated` audit entry (`{ field: { from, to } }`).
 * A request that changes nothing writes nothing and leaves `updated_at` alone.
 */
class UpdateCustomerAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     */
    public function execute(Customer $customer, array $attributes, User $actor, ?string $ip = null): Customer
    {
        return DB::transaction(function () use ($customer, $attributes, $actor, $ip): Customer {
            $customer->fill($attributes);

            $changes = ModelChanges::diff($customer);

            if ($changes === []) {
                return $customer;
            }

            $customer->forceFill(['updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'customer.updated',
                actor: $actor,
                subject: $customer,
                changes: $changes,
                ip: $ip,
            );

            return $customer;
        });
    }
}
